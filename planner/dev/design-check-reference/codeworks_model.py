#!/usr/bin/env python3
"""Explicit-state model of the Codeworks state machine, checked by exhaustive BFS.

Spec modelled: the Codeworks design text of 2026-10-20 (State, Transitions, tick grid, The PR, Holds,
Predicates; "design l.N" cites its lines) and the decision records at commit 68b0fbe2e8
(PR #142). Where they disagree the record is modelled; every such place is listed in
DISAGREEMENTS and printed with --notes.

Abstractions (kept small enough to enumerate):
  * A head is never named; every head-bound fact (attestation, CI, Codex, request, CodeRabbit pass)
    is a flag that a head move resets.
  * One findings slot per story PR (none / bot thread / writer thread / outsider thread /
    threadless open / threadless pushed back / conflict); required CI is a separate field.
  * claim and shim holds are folded into one commit-refusing hold `clm`.
  * [reviewer] github round cap = 1 (a config number); an audit stage past it places audit-<s>.
  * A builder launch is a start step plus one compound work step that ends the turn; budgets bound
    disruptive humans, reopens, outsiders, extra external findings, crashes and rescopes.

  * A rescope starts only while each story's PR is quiet (--rescope-held also allows open holds); the
    spec PR's own Codex verdict is not modelled; the H6 scenario keeps the added story in Backlog.

Run:  python3 codeworks_model.py --variant one --budget dis=1             (one scenario, as written)
      python3 codeworks_model.py --variant one --budget dis=1 --fix all   (every fix applied)
      ./runsuite.sh <outdir> [--fix all]     (every SUITE scenario, three processes at a time)
      ./ablate.sh <outdir>                   (--fix all minus each fix, on the scenario that needs it)
"""
import argparse
import sys
from collections import namedtuple, deque, defaultdict

# ---------------------------------------------------------------- vocabulary
BL, RD, IP, IR, BK, DN = 'Backlog', 'Ready', 'InProgress', 'InReview', 'Blocked', 'Done'
NONE, DRAFT, READY, MERGED, CLOSED = 'none', 'draft', 'ready', 'merged', 'closed'
HOLDS = ('esc', 'pb', 'aud', 'clm', 'rsc')
CAP = 1  # github round cap in [reviewer]

ALL_FIXES = {
    'K1': "reviewer 0020 d2 watch brackets only what an open hold refuses: the session's merge of main "
          "is not watched under rescope-<s> (it is the hold's release path)",
    'K12': "tick grid tests EXEMPT on a story PR: internal-review 'exempt' counts as ATTESTED in the "
           "working rows, and an exempt PR with findings goes to Blocked instead of a launch",
    'S3': "every Blocked/bounced card gets the missing keyed reason of every open hold (the escalation "
          "question included), whichever cause moved it, and a human drag to Blocked too",
    'S4': "REPEAT also requires the exit state to still need work: not ATTESTED(head) or FINDINGS",
    'S5': "the lane write is the commit point: write Blocked first, post missing keyed reasons from "
          "the Blocked lane on every tick; a restart marks an orphaned entry instead of dropping it, "
          "and 'no launch logged or newest orphaned' launches",
    'S9': "In review with codex-review = failure and no findings/hold -> Blocked naming dismiss and "
          "re-request, or the bypass merge",
    'T9': "reviewer admits a planner session's commits on <p>-spec (spec folder and docs/adr only); "
          "the lane rule is builder-only",
    'L4': "planner opens the draft spec PR (and places the rescope holds) as the run's first write, "
          "so ¬SPEC_LANDED gates every launch for the whole rescope run",
    'L6': "a story whose PR merged counts as closed for BLOCKERS_CLOSED and for a parent's completion",
    'SIL': "a validator module's silence is timed from the orchestrator's own trigger (REQUESTED), never "
           "from the push: Codex, triggered only once GREEN, cannot be SILENT before it was asked",
    'GHR': "only a human act (Ready, or unlock of audit-<s>) resets the github round count; neither an "
           "internal CLEAN nor the audit stage's CONVERGED_PUSHBACK does (reviewer 0019 d5, design Holds "
           "'a clean round, or CONVERGED_PUSHBACK, resets the count')",
    'WV': "a WAIVED codex-review is not a pass: the PR goes to Blocked naming the re-request or a "
          "human bypass merge (design l.73/M7 'out of credits -> pass marked WAIVED')",
    'OUT': "an unresolved thread whose latest author is not in trusted_reviewers is not a FINDING: the "
           "orchestrator's PR sweep resolves it unread with the fixed reply, so no outsider comment buys a launch",
    'LOCK': "issue-tackle takes the story's launch lock: it refuses to start beside a running launch, "
            "and a running interactive session counts as RUNNING for the tick",
    'SC': "holds fail closed: reviewer reads the open holds from every reviewer-state snapshot (or a "
          "missing snapshot on a story with a PR reads as held); deleting the newest comment releases nothing",
    'PLW': "planner's rescope precondition also requires no running launch on any story of the spec "
           "(a drag to Blocked stops the launch only on the next tick)",
    'S2': "rescope precondition and rescope-<s> cover every open claimed story of the spec, not only "
          "those with a branch (ruling H1); records say 'a story with a branch'",
    'UNL': "unlock-<hold> is refused while planner runs on the story's spec (planner is then the state "
           "comment's writer)",
    'T7': "EXEMPT on a story PR binds to a head: a push after the labeled event makes internal-review "
          "pending again, and the card goes to Blocked naming the re-label",
    'LB': "bound automated relaunches: a launch from a working lane (not after a human's Ready) that ends "
          "with the head still unattested counts; the second such in a row -> Blocked naming the bound",
}
FIX = set()
RESCOPE_HELD_START = False   # --rescope-held: a rescope may also start on a story that holds a hold
LITERAL_GRID = False   # True: the grid launches on an exempt story PR (design); False: record 0005 d3


def fx(name):
    return name in FIX


# ---------------------------------------------------------------- state
Story = namedtuple('Story', [
    'exists', 'lane', 'lane_h', 'claimed', 'open',
    'pr', 'rfr', 'branch', 'br_rev', 'br_ver',
    'att', 'ci', 'codex', 'req', 'cr', 'fnd', 'pbk', 'exempt', 'ex_stale',
    'esc', 'esc_ans', 'pb', 'aud', 'clm', 'rsc', 'rsc_rec',
    'rr',                         # frozenset of reason keys posted for the current cause instances
    'sess', 'sp', 'ws',           # sess 0 none / 1 orchestrator launch (lock) / 2 orphan / 3 human session
    'log', 'l_nw', 'l_fp', 'l_mv', 'l_chg', 'l_pr', 'l_hd', 'l_ready', 'old',
    'ghr', 'nl', 'merged_by'])
Parent = namedtuple('Parent', ['exists', 'lane', 'open', 'par_r'])
Spec = namedtuple('Spec', ['pr', 'approved', 'codex', 'landed', 'rev', 'ver', 'chg', 'h6', 'h6_rev',
                           'rescope'])
Planner = namedtuple('Planner', ['phase', 'kind', 'rev_on'])
Budget = namedtuple('Budget', ['dis', 'outs', 'crash', 'resc', 'ext', 'reo', 'h6'])
State = namedtuple('State', ['st', 'par', 'spec', 'pl', 'bud'])


def fresh_story(exists=True):
    return Story(exists, BL, False, False, True, NONE, False, False, 0, 0,
                 False, 'pend', 'none', False, False, None, False, False, False,
                 False, False, False, False, False, False, 0,
                 frozenset(), 0, 0, 0,
                 None, False, None, False, False, False, False, False, None,
                 0, 0, None)


def initial(variant, bud):
    if variant == 'two':
        st = (fresh_story(), fresh_story())
        par = Parent(True, BL, True, False)
        spec = Spec(MERGED, False, 'none', True, 0, 0, False, False, 0, False)
        pl = Planner('idle', None, True)
    elif variant == 'one':
        st = (fresh_story(), fresh_story(False))
        par = Parent(False, BL, True, False)
        spec = Spec(MERGED, False, 'none', True, 0, 0, False, False, 0, False)
        pl = Planner('idle', None, True)
    elif variant == 'new':
        st = (fresh_story(), fresh_story())
        par = Parent(True, BL, True, False)
        spec = Spec(NONE, False, 'none', False, 0, 0, False, False, 0, False)
        pl = Planner('running', 'new', True)
        bud = bud._replace(resc=0)
    else:
        raise ValueError(variant)
    return State(st, par, spec, pl, bud)


def set_story(G, i, s):
    st = list(G.st)
    st[i] = s
    return G._replace(st=tuple(st))


# ---------------------------------------------------------------- predicates (design "Predicates")
def HOLD(s):
    return s.esc or s.pb or s.aud or s.clm or s.rsc


def COMMIT_HOLD(s):          # holds that refuse commits (rescope: every code commit)
    return s.esc or s.clm or s.rsc


def ROUND_HOLD(s):
    return s.esc or s.pb or s.aud


def GREEN(s):
    return s.ci == 'green'


def FAILING(s):
    return s.ci in ('fail', 'err')


def PENDING(s):
    return s.ci == 'pend'


def SILENT(s):
    return s.ci == 'slow' or s.codex == 'silent' or (fx('WV') and s.codex == 'waived')


def CONFLICT(s):
    return s.fnd == 'conflict'


def FINDINGS(s):
    return s.fnd in ('bot', 'writer', 'outsider', 'tl_open', 'conflict') or FAILING(s)


def VERDICT(s):
    return s.codex in ('pass', 'waived', 'fail')


def CODEX_OK(s):
    return s.codex == 'pass' or (s.codex == 'waived' and not fx('WV'))


def ATT(s):
    """ATTESTED(head) as the tick reads it; with fix K12 an exempt story PR counts as attested."""
    return s.att or (fx('K12') and s.exempt and not (fx('T7') and s.ex_stale))


def RE_REQUEST(s):
    return ATT(s) and GREEN(s) and not FINDINGS(s) and not VERDICT(s) and not s.req


def MERGEABLE(s):
    return (not CONFLICT(s) and GREEN(s) and (s.att or (s.exempt and not (fx('T7') and s.ex_stale)))
            and CODEX_OK(s)
            and s.fnd not in ('bot', 'writer', 'outsider'))


def RUNNING(s):
    # design l.224: the process lock lives with the launch process, so a launch that outlives an
    # orchestrator restart (sess 2) still holds it
    return s.sess in (1, 2) or (fx('LOCK') and s.sess == 3)


def needs_work(s):
    return (not s.att) or FINDINGS(s)


def REPEAT(s):
    r = s.log == 'exit' and s.l_nw and not s.l_chg and not s.l_hd
    if fx('S5'):
        r = s.log == 'exit' and s.l_nw and not s.l_chg   # HANDLED only suppresses the duplicate post
    if fx('S4'):
        r = r and (not ATT(s) or FINDINGS(s))
    return r


def CONVERTED(s):
    return s.pr == DRAFT and s.rfr


def SPEC_LANDED(G):
    return G.spec.landed and G.spec.pr not in (DRAFT, READY)


def story_done_for_blockers(s):
    if fx('L6'):
        return (not s.open) or s.pr == MERGED
    return not s.open


def BLOCKERS_CLOSED(G, i):
    return i == 0 or story_done_for_blockers(G.st[0])


def ESC_UNANSWERED(s):
    return s.esc and not s.esc_ans


def rescope_in_progress(G):
    return ((G.pl.phase == 'running' and G.pl.kind == 'rescope')
            or (G.spec.pr in (DRAFT, READY) and G.spec.rescope))


def hold_keys(s):
    return [h for h in HOLDS if getattr(s, h)]


# ---------------------------------------------------------------- head movement
def fp(s):
    return (s.fnd, FAILING(s))


def move_head(s, fnd):
    s = s._replace(att=False, ci='pend', codex='none', req=False, cr=False, fnd=fnd, pbk=False,
                   ex_stale=s.exempt, rr=s.rr - {'sil'})
    if s.log == 'run':
        s = s._replace(l_mv=True)
    return s


def new_pr(s):
    return s._replace(pr=DRAFT, rfr=False, req=False, codex='none', cr=False, fnd=None, pbk=False,
                      exempt=False, ex_stale=False)


# ---------------------------------------------------------------- violations bookkeeping
class V:
    """Collects violations raised while generating one transition."""
    def __init__(self):
        self.items = []

    def add(self, key, detail=''):
        self.items.append((key, detail))


# ---------------------------------------------------------------- orchestrator writes
def w_lane(i, lane):
    def f(G, v):
        s = G.st[i]
        return set_story(G, i, s._replace(lane=lane, lane_h=False))
    return ('lane:' + lane, f)


def w_post(i, key):
    def f(G, v):
        s = G.st[i]
        if key == 'launch':
            if REPEAT(s) and ATT(s) and not FINDINGS(s) and not HOLD(s):
                v.add('repeat_on_finished_head', 'REPEAT blocks a story whose head is attested with nothing to fix')
            return set_story(G, i, s._replace(l_hd=True))
        if key == 'sil' and s.codex == 'silent' and not s.req and s.ci != 'slow':
            v.add('silent_unrequested', 'Blocked naming Codex silent at a head the orchestrator never asked it to review')
        return set_story(G, i, s._replace(rr=s.rr | {key}))
    return ('post:' + key, f)


def posted(s, key):
    return s.l_hd if key == 'launch' else key in s.rr


def w_block(i, s, causes, post=True):
    """Blocked move: post the reason of each cause not yet posted, then write the lane."""
    W = []
    keys = list(causes)
    if fx('S3'):
        keys += [h for h in hold_keys(s) if h not in keys]
    posts = [w_post(i, k) for k in keys if post and not posted(s, k)]
    if fx('S5'):
        return [w_lane(i, BK)] + posts          # lane first; reasons are re-posted from Blocked
    return posts + [w_lane(i, BK)]


def w_assign(i):
    def f(G, v):
        return set_story(G, i, G.st[i]._replace(claimed=True))
    return ('assign', f)


def w_launch(i, from_ready):
    def f(G, v):
        s = G.st[i]
        if s.sess in (2, 3):
            v.add('two_sessions', 'orchestrator launch while an %s session runs on the story'
                  % ('orphaned' if s.sess == 2 else 'interactive'))
        if s.fnd == 'outsider' and s.att and not FAILING(s) and not from_ready:
            v.add('outsider_launch', 'a builder launch whose only work is a thread by a non-trusted author')
        if G.pl.phase == 'running' and G.pl.kind == 'rescope':
            v.add('launch_during_rescope_run', 'a story launches while planner runs a rescope of its spec')
        old = (s.l_nw, s.l_chg, s.l_pr, s.l_hd) if s.log in ('exit', 'orphan') else None
        s = s._replace(sess=1, sp=0, ws=0, log='run', l_nw=needs_work(s), l_fp=fp(s), l_mv=False,
                       l_chg=False, l_pr=False, l_hd=False, l_ready=from_ready, old=old,
                       nl=0 if from_ready else s.nl,
                       ghr=0 if (from_ready and fx('GHR')) else s.ghr)
        return set_story(G, i, s)
    return ('launch' + ('(after Ready)' if from_ready else ''), f)


def w_stop(i):
    def f(G, v):
        return set_story(G, i, end_session(G.st[i]))
    return ('stop launch', f)


def w_flip(i):
    def f(G, v):
        return set_story(G, i, G.st[i]._replace(pr=READY, rfr=True))
    return ('ready flip', f)


def w_codex_req(i):
    def f(G, v):
        s = G.st[i]
        return set_story(G, i, s._replace(req=True, codex='silent' if s.codex == 'silent' else 'pend'))
    return ('codex request', f)


def w_merge(i):
    def f(G, v):
        s = G.st[i]
        if HOLD(s):
            v.add('merge_with_hold_open', ','.join(hold_keys(s)))
        if rescope_in_progress(G):
            v.add('merge_during_rescope', 'story merges while a rescope of its spec is in progress')
        if s.br_ver != G.spec.ver:
            v.add('merge_outdated_spec', 'branch spec.md v%d, main v%d' % (s.br_ver, G.spec.ver))
        if s.codex == 'waived':
            v.add('merge_codex_waived', 'codex-review success marked WAIVED: no Codex review at the head')
        if not s.att and s.exempt and s.ex_stale:
            v.add('merge_exempt_label_predates_head', 'exempt label applied before the head merged')
        if not GREEN(s) or not (s.att or s.exempt) or not CODEX_OK(s):
            v.add('merge_not_green', '')
        s = s._replace(pr=MERGED, open=False, lane=DN, lane_h=False, merged_by='orch')
        return set_story(G, i, s)
    return ('squash merge', f)


# ---------------------------------------------------------------- the tick (design "tick grid")
def working_cell(G, i, s):
    """The 'In progress or In review' row; returns (writes, outcome)."""
    W, o = working_cell_raw(G, i, s)
    if fx('LB') and o == 'launch' and s.nl >= 1:
        return w_block(i, s, ['bound']), 'block:launch-bound'
    return W, o


def working_cell_raw(G, i, s):
    W = []
    if s.pr == NONE:
        if RUNNING(s):
            return W, 'wait'
        no_launch = s.log is None or (fx('S5') and s.log == 'orphan')
        if no_launch:
            return W + ([w_lane(i, IP)] if s.lane != IP else []) + [w_launch(i, False)], 'launch'
        if s.log == 'exit' and (not s.l_hd or fx('S5')):
            if fx('S5') and s.l_hd and s.lane == BK:
                return W, 'none'
            return W + w_block(i, s, ['launch']), 'block:launch-no-PR'
        return W, 'UNDEF'
    if s.pr == DRAFT:
        if RUNNING(s):
            return W + ([w_lane(i, IP)] if s.lane != IP else []), 'wait'
        if CONVERTED(s) or REPEAT(s):
            causes = (['conv'] if CONVERTED(s) else []) + (['launch'] if REPEAT(s) else [])
            return W + w_block(i, s, causes), 'block:' + '+'.join(causes)
        if HOLD(s):
            return W + w_block(i, s, hold_keys(s)), 'block:hold'
        if fx('T7') and s.exempt and s.ex_stale and not s.att:
            return W + w_block(i, s, ['exstale']), 'block:exempt-stale'
        if ATT(s):
            W.append(w_flip(i))
            if s.lane != IP:
                W.append(w_lane(i, IP))
            return W, 'flip'
        if fx('K12') and s.exempt and FINDINGS(s):
            return W + w_block(i, s, ['exfind']), 'block:exempt-findings'
        if s.exempt and not LITERAL_GRID:
            return W, 'UNDEF'           # record 0005 d3 forbids the launch the grid prescribes
        if CONFLICT(s):
            return W + ([w_lane(i, IP)] if s.lane != IP else []) + [w_launch(i, False)], 'launch'
        return W + ([w_lane(i, IP)] if s.lane != IP else []) + [w_launch(i, False)], 'launch'
    if s.pr == READY:
        if RUNNING(s):
            return W + ([w_lane(i, IP)] if s.lane != IP else []), 'wait'
        if HOLD(s) or REPEAT(s) or SILENT(s):
            causes = hold_keys(s) + (['launch'] if REPEAT(s) else []) + (['sil'] if SILENT(s) else [])
            return W + w_block(i, s, causes), 'block:' + '+'.join(
                (['hold'] if HOLD(s) else []) + (['REPEAT'] if REPEAT(s) else []) + (['SILENT'] if SILENT(s) else []))
        if fx('T7') and s.exempt and s.ex_stale and not s.att:
            return W + w_block(i, s, ['exstale']), 'block:exempt-stale'
        if fx('K12') and s.exempt and FINDINGS(s):
            return W + w_block(i, s, ['exfind']), 'block:exempt-findings'
        if FINDINGS(s) or not ATT(s):
            if s.exempt and not LITERAL_GRID:
                return W, 'UNDEF'
            return W + ([w_lane(i, IP)] if s.lane != IP else []) + [w_launch(i, False)], 'launch'
        if PENDING(s):
            return W + ([w_lane(i, IP)] if s.lane != IP else []), 'wait'
        if ATT(s) and GREEN(s) and not FINDINGS(s):
            if s.lane != IR:
                W.append(w_lane(i, IR))
            if RE_REQUEST(s):
                W.append(w_codex_req(i))
                return W, 'in-review+request'
            if not HOLD(s) and CODEX_OK(s) and MERGEABLE(s):
                W.append(w_merge(i))
                return W, 'merge'
            if fx('S9') and s.codex == 'fail':
                return W + w_block(i, s, ['codexfail']), 'block:codex-failure'
            return W, 'in-review'
        return W, 'UNDEF'
    if s.pr == MERGED:
        return W, ('wait' if RUNNING(s) else 'none')
    if s.pr == CLOSED:
        if RUNNING(s):
            return W, 'wait'
        return W + w_block(i, s, ['clo']), 'block:CLOSED'
    return W, 'UNDEF'


def tick_story(G, i):
    s = G.st[i]
    if not s.exists:
        return [], 'none'
    W = []
    # the PR sweep, before the cards
    if fx('OUT') and s.fnd == 'outsider' and s.pr in (DRAFT, READY):
        def f_out(G, v):
            return set_story(G, i, G.st[i]._replace(fnd=None))
        W.append(('resolve untrusted thread unread', f_out))
        s = s._replace(fnd=None)
    if s.pr == READY and not VERDICT(s) and not s.req and (s.exempt or RE_REQUEST(s)):
        W.append(w_codex_req(i))
    lane = s.lane
    if lane in (BL, BK, DN):
        if RUNNING(s):
            return W + [w_stop(i)], 'stop'
        if fx('S5') and lane == BK:
            # Blocked-lane pass: post every missing keyed reason of the card's current causes
            causes = hold_keys(s) + (['launch'] if (s.log == 'exit' and (REPEAT(s) or
                                                    (s.pr == NONE))) else [])
            ps = [w_post(i, k) for k in causes if not posted(s, k)]
            return W + ps, 'post-missing' if ps else 'none'
        return W, 'none'
    if lane == RD:
        def ready_gate():
            if RUNNING(s):
                return [], 'wait'
            if not SPEC_LANDED(G):
                return w_block(i, s, ['spec']), 'block:spec'
            if not BLOCKERS_CLOSED(G, i):
                return [], 'wait-blockers'
            return None
        if s.pr == NONE:
            g = ready_gate()
            if g:
                return W + g[0], g[1]
            if ESC_UNANSWERED(s):          # record orch 0002 d3 (grid omits it in this column)
                return W + w_block(i, s, [], post=fx('S3')), 'block:escalation-unanswered'
            return W + [w_assign(i), w_lane(i, IP), w_launch(i, True)], 'launch'
        if s.pr == DRAFT:
            g = ready_gate()
            if g:
                return W + g[0], g[1]
            if CONVERTED(s):
                return W + w_block(i, s, ['conv']), 'block:CONVERTED'
            if ESC_UNANSWERED(s):
                return W + w_block(i, s, [], post=fx('S3')), 'block:escalation-unanswered'
            if not HOLD(s) and ATT(s):
                ws, o = working_cell(G, i, s)
                return W + ws, 'working:' + o
            if s.exempt and not LITERAL_GRID and not fx('K12'):
                return W, 'UNDEF'
            return W + [w_assign(i), w_lane(i, IP), w_launch(i, True)], 'launch'
        if s.pr == READY:
            g = ready_gate()
            if g:
                return W + g[0], g[1]
            if ESC_UNANSWERED(s):
                return W + w_block(i, s, [], post=fx('S3')), 'block:escalation-unanswered'
            if not HOLD(s) and ATT(s) and GREEN(s) and not FINDINGS(s):
                ws, o = working_cell(G, i, s)
                return W + ws, 'working:' + o
            if s.exempt and not LITERAL_GRID and not fx('K12'):
                return W, 'UNDEF'
            if fx('K12') and s.exempt and not HOLD(s):
                ws, o = working_cell(G, i, s)
                return W + ws, 'working:' + o
            return W + [w_assign(i), w_lane(i, IP), w_launch(i, True)], 'launch'
        if s.pr == MERGED:
            return W, ('wait' if RUNNING(s) else 'none')
        if s.pr == CLOSED:
            g = ready_gate()
            if g:
                return W + g[0], g[1]
            if ESC_UNANSWERED(s):          # record orch 0002 d3
                return W + w_block(i, s, [], post=fx('S3')), 'block:escalation-unanswered'
            return W + [w_assign(i), w_lane(i, IP), w_launch(i, True)], 'launch'
    if lane in (IP, IR):
        if not s.claimed:
            return W, 'none'
        ws, o = working_cell(G, i, s)
        return W + ws, o
    return W, 'UNDEF'


def tick_parent(G):
    p = G.par
    if not p.exists or not p.open:
        return [], 'none'
    subs = [s for s in G.st if s.exists]
    if p.lane == RD:
        def f1(G, v):
            return G._replace(par=G.par._replace(par_r=True))

        def f2(G, v):
            return G._replace(par=G.par._replace(lane=BK))
        W = ([] if p.par_r else [('post:parent', f1)]) + [('parent lane:Blocked', f2)]
        return W, 'block:parent'
    if all(story_done_for_blockers(s) for s in subs):
        def f(G, v):
            return G._replace(par=G.par._replace(open=False, lane=DN))
        return [('close parent', f)], 'close-parent'
    return [], 'none'


def tick_spec(G):
    sp = G.spec
    if sp.pr == READY and sp.approved and sp.codex == 'none':
        def f(G, v):
            return G._replace(spec=G.spec._replace(codex='pend'))
        return [('spec PR codex request', f)], 'request'
    return [], 'none'


# ---------------------------------------------------------------- sessions (builder + reviewer)
def end_session(s):
    if s.sess == 1:
        if fx('LB'):
            s = s._replace(nl=0 if s.att else (s.nl + (0 if s.l_ready else 1)))
        chg = s.l_mv or fp(s) != s.l_fp
        return s._replace(sess=0, sp=0, ws=0, log='exit', l_chg=chg, l_pr=s.pr in (DRAFT, READY),
                          l_fp=None, l_mv=False)
    return s._replace(sess=0, sp=0, ws=0)


def parked(s):
    return s.lane in (BL, BK)


def place(s, h):
    d = {h: True, 'rr': s.rr - {h}}
    if h == 'esc':
        d['esc_ans'] = False
    if h == 'rsc':
        d['rsc_rec'] = s.br_ver
    return s._replace(**d)


def watched(s):
    """reviewer 0020 d2: is a Bash change to the branch put back?"""
    if fx('K1'):
        return s.esc or s.clm            # the merge of main is not what rescope refuses
    return COMMIT_HOLD(s)


def merge_main(G, s, fnd_after):
    """The session's `git merge` of main, a Bash command under the held-branch watch."""
    if watched(s):
        return s, False
    s = move_head(s, fnd_after)
    s = s._replace(br_rev=G.spec.rev, br_ver=G.spec.ver)
    if s.rsc and s.br_ver != s.rsc_rec:            # SPEC_CHANGED, checked at commit/round launch
        s = s._replace(rsc=False, rr=s.rr - {'rsc'})
    return s, True


def session_steps(G, i):
    """Yield (label, kind, G2, viols) for the story's running session."""
    s = G.st[i]
    if s.sess == 0:
        return
    if s.sp == 0:
        if parked(s):
            yield ('session stops: card parked', 'S', set_story(G, i, end_session(s)), [])
            return
        if s.sess == 1 and s.l_ready:
            rel = dict(pb=False, aud=False, clm=False)
            if s.esc and s.esc_ans:
                rel['esc'] = False
            s = s._replace(**rel)
        if s.branch and s.br_rev != G.spec.rev:
            s2, ok = merge_main(G, s, None if s.fnd == 'conflict' else s.fnd)
            if not ok:
                s = s._replace(sp=1)
                lbl = 'session start: merge of main put back by the held-branch watch'
            else:
                s = s2._replace(sp=1)
                lbl = 'session start: merge main'
        else:
            s = s._replace(sp=1)
            lbl = 'session start'
        if G.spec.h6_rev and s.branch and s.br_rev < G.spec.h6_rev:
            yield (lbl + '; spec folder specs/<p>-* missing on the branch -> stop', 'S',
                   set_story(G, i, end_session(s)), [])
            return
        yield (lbl, 'S', set_story(G, i, s), [])
        return
    # one work step, after which the turn ends (a compound of the session's inner loop)
    yield ('session ends turn', 'S', set_story(G, i, end_session(s)), [])
    for lbl, t in work_outcomes(G, s):
        yield (lbl + '; turn ends', 'S', set_story(G, i, end_session(t)), [])


def work_outcomes(G, s):
    if s.rsc and not s.branch and G.spec.ver != s.rsc_rec:
        s = s._replace(rsc=False, rr=s.rr - {'rsc'})     # the branch is cut from a main whose spec.md changed
    prk = parked(s)
    commit_ok = not prk and not COMMIT_HOLD(s)
    round_ok = not prk and not ROUND_HOLD(s)

    def clean(t):
        t = t._replace(att=True)
        if not fx('GHR'):
            t = t._replace(ghr=0)          # reviewer 0019 d5: "a clean round ... resets the count"
        return t
    if s.pr in (NONE, CLOSED):
        if s.pr == CLOSED:
            yield 'builder opens a new draft PR on the branch', new_pr(s)
        elif commit_ok:
            t = s
            if not t.branch:
                t = t._replace(branch=True, br_rev=G.spec.rev, br_ver=G.spec.ver)
            t = new_pr(move_head(t, None))
            yield 'builder first push + draft PR', t
            if not t.exempt and round_ok:
                yield 'builder first push + draft PR, internal round CLEAN', clean(t)
                yield 'builder first push + draft PR, internal round ESCALATE', place(t, 'esc')
        return
    if s.pr not in (DRAFT, READY):
        return
    if not s.att and not s.exempt and round_ok:
        yield 'internal round CLEAN', clean(s)
        if commit_ok:
            t = move_head(s, s.fnd)
            yield 'internal round FIX -> push', t
            yield 'internal round FIX -> push -> internal round CLEAN', clean(t)
            yield 'internal round FIX -> push -> internal round ESCALATE', place(t, 'esc')
            yield 'internal round FIX: commit refused, claim hold placed', place(s, 'clm')
        yield 'internal round ESCALATE', place(s, 'esc')
        yield 'internal round RESCOPE', place(s, 'rsc')
    if FINDINGS(s) and round_ok:
        if s.fnd == 'outsider':
            yield 'github round launch: outsider thread resolved unread', s._replace(fnd=None)
            return
        if s.ghr >= CAP:
            # reviewer 0019 d5: past the cap the session runs the audit stage instead of a github round
            yield 'audit stage (round cap): not CONVERGED -> audit hold', place(s, 'aud')
            t = s._replace(ghr=s.ghr if fx('GHR') else 0, pbk=True,
                           fnd={'tl_open': 'tl_pushed', 'bot': None, 'writer': None}.get(s.fnd, s.fnd))
            if s.codex == 'fail' or FAILING(s):
                t = place(t, 'pb')
            yield 'audit stage CONVERGED_PUSHBACK', t
            return
        s = s._replace(ghr=s.ghr + 1)
        lbl = 'github round'
        if s.fnd == 'conflict':
            if not prk:
                t, ok = merge_main(G, s, None)
                if ok:
                    yield lbl + ' FIX: merge main resolves the conflict', t
                    if round_ok:
                        yield lbl + ' FIX: merge main resolves the conflict -> internal round CLEAN', clean(t)
                else:
                    yield lbl + ' FIX: merge of main put back by the held-branch watch', s
        else:
            if commit_ok:
                t = move_head(s, None)
                yield lbl + ' FIX -> push', t
                yield lbl + ' FIX -> push -> internal round CLEAN', clean(t)
            t = s._replace(pbk=True, fnd={'tl_open': 'tl_pushed', 'bot': None, 'writer': None}.get(s.fnd, s.fnd))
            if s.codex == 'fail' or FAILING(s):
                t = place(t, 'pb')
            yield lbl + ' PUSH_BACK all', t
        yield lbl + ' ESCALATE', place(s, 'esc')

# ---------------------------------------------------------------- planner
def planner_steps(G):
    pl = G.pl
    if pl.phase != 'running':
        return
    if pl.rev_on and not fx('T9'):
        return                       # reviewer refuses the commit: see state check planner_commit_refused
    h6s = [False, True] if (pl.kind == 'rescope' and not G.par.exists and G.bud.h6) else [False]
    for h6 in h6s:
        v = V()
        H = G
        if not (fx('L4') and G.spec.pr in (DRAFT, READY)):
            H = H._replace(spec=H.spec._replace(pr=DRAFT, approved=False, codex='none',
                                                rescope=pl.kind == 'rescope'))
            H = place_rescope_holds(H, v)
        H = H._replace(spec=H.spec._replace(h6=h6))
        st = list(H.st)
        for j, s in enumerate(st):
            if s.exists:
                st[j] = s._replace(rr=s.rr - {'spec'})
        H = H._replace(st=tuple(st))
        if h6:
            st = list(H.st)
            st[1] = fresh_story(True)
            H = H._replace(st=tuple(st), par=Parent(True, BL, True, False),
                           spec=H.spec._replace(landed=False))
        H = H._replace(pl=pl._replace(phase='opened'))
        yield ('planner pushes <p>-spec, opens draft spec PR%s' % (', H6 new parent + story' if h6 else ''),
               'P', H, v.items)


def place_rescope_holds(G, v):
    st = list(G.st)
    for j, s in enumerate(st):
        if s.exists and (s.branch or (fx('S2') and s.open and s.claimed)):
            if s.sess != 0:
                v.add('two_state_writers', 'planner places rescope-%d while a session runs on it' % j)
            st[j] = place(s, 'rsc')
    return G._replace(st=tuple(st))


# ---------------------------------------------------------------- humans
def human_steps(G):
    """Yield (label, kind, G2, viols); kind 'Hn' design-named, 'Hd' disruptive (budgeted)."""
    b = G.bud
    for i, s in enumerate(G.st):
        if not s.exists:
            continue
        n = 's%d' % i
        # named
        # abstraction: in the H6 scenario the story planner adds stays in Backlog (the run checks s0)
        if s.lane in (BL, BK, IP, IR) and s.open and not (s.lane in (IP, IR) and s.claimed) \
                and not (b.h6 and i == 1):
            yield ('human: %s -> Ready' % n, 'Hn', set_story(G, i, s._replace(lane=RD, lane_h=True)), [])
        if s.lane in (RD, IP, IR) and (b.resc > 0 and G.pl.phase == 'idle' and s.branch):
            yield ('human: drag %s -> Blocked before a rescope' % n, 'Hn',
                   set_story(G, i, s._replace(lane=BK, lane_h=True)), [])
        elif s.lane in (RD, IP, IR) and b.dis > 0:
            yield ('human: drag %s -> Blocked (stop)' % n, 'Hd',
                   set_story(G._replace(bud=b._replace(dis=b.dis - 1)), i, s._replace(lane=BK, lane_h=True)), [])
        if s.esc and not s.esc_ans and 'esc' in s.rr:
            yield ('human: writer answers the escalation on %s' % n, 'Hn',
                   set_story(G, i, s._replace(esc_ans=True)), [])
        for h in HOLDS:
            if getattr(s, h):
                if h == 'rsc' and not (G.spec.pr not in (DRAFT, READY) and G.spec.ver == s.rsc_rec):
                    continue        # unlock rescope only for a rescope that left spec.md unchanged
                v = []
                if G.pl.phase == 'running':
                    if fx('UNL'):
                        continue
                    v = [('two_state_writers', 'unlock %s writes the state comment while planner runs' % h)]
                rel = {h: False}
                if h == 'aud' and fx('GHR'):
                    rel['ghr'] = 0
                yield ('human: unlock %s-%s' % (h, n), 'Hn', set_story(G, i, s._replace(**rel)), v)
        s9_named = fx('S9') and s.codex == 'fail' and not FINDINGS(s)
        if s.codex == 'fail' and (s.pb or s.pbk or s9_named):
            yield ('human: dismiss Codex review + re-request on %s' % n, 'Hn',
                   set_story(G, i, s._replace(codex='pend')), [])
        if (s.pb or s.pbk or s9_named or (fx('WV') and s.codex == 'waived')) and s.pr in (DRAFT, READY):
            # the orchestrator's next tick stops a running launch on the Done card; folded in here
            yield ('human: bypass merge %s' % n, 'Hn',
                   set_story(G, i, end_session(s)._replace(pr=MERGED, open=False, lane=DN, lane_h=False,
                                                           merged_by='human')), [])
        if s.codex == 'silent' or (fx('WV') and s.codex == 'waived'):
            yield ('human: re-request silent Codex on %s' % n, 'Hn', set_story(G, i, s._replace(codex='pend')), [])
        if s.ci == 'slow' and s.pr in (DRAFT, READY):
            yield ('human: re-run check on %s' % n, 'Hn', set_story(G, i, s._replace(ci='pend')), [])
        if CONVERTED(s):
            yield ('human: re-mark %s PR ready' % n, 'Hn', set_story(G, i, s._replace(pr=READY)), [])
        if fx('T7') and s.exempt and s.ex_stale and s.pr in (DRAFT, READY):
            yield ('human: re-applies the exempt label at the head of %s' % n, 'Hn',
                   set_story(G, i, s._replace(ex_stale=False)), [])
        if s.lane == BK and s.pr in (DRAFT, READY):
            if s.l_hd or (fx('K12') and s.exempt and FINDINGS(s)):
                yield ('human: push to %s branch (REPEAT release)' % n, 'Hn', set_story(G, i, move_head(s, s.fnd)), [])
                if s.fnd in ('tl_open', 'tl_pushed', 'conflict'):
                    yield ('human: pushes a fix for the finding on %s' % n, 'Hn',
                           set_story(G, i, move_head(s, None)), [])
            if s.fnd in ('bot', 'writer', 'outsider'):
                yield ('human: resolve thread on %s' % n, 'Hn', set_story(G, i, s._replace(fnd=None)), [])
        # disruptive
        if b.dis > 0:
            H = G._replace(bud=b._replace(dis=b.dis - 1))
            for ln in (IP, IR):
                if s.lane != ln and s.lane != DN:
                    yield ('human: drag %s -> %s' % (n, ln), 'Hd', set_story(H, i, s._replace(lane=ln, lane_h=True)), [])
            if s.open:
                yield ('human: drag %s -> Done (closes issue)' % n, 'Hd',
                       set_story(H, i, s._replace(lane=DN, lane_h=True, open=False)), [])
            if s.pr in (DRAFT, READY):
                yield ('human: close %s PR unmerged' % n, 'Hd',
                       set_story(H, i, s._replace(pr=CLOSED, rr=s.rr - {'clo'})), [])
                if not s.exempt:
                    yield ('human: exempt label on %s story PR' % n, 'Hd',
                           set_story(H, i, s._replace(exempt=True, ex_stale=False)), [])
            if s.pr == READY:
                yield ('human: convert %s PR to draft' % n, 'Hd',
                       set_story(H, i, s._replace(pr=DRAFT, rr=s.rr - {'conv'})), [])
            if not s.open:
                yield ('human: reopen %s issue' % n, 'Hd', set_story(H, i, s._replace(open=True)), [])
            if s.sess == 0 and s.open:
                yield ('human: runs issue-tackle %s interactively' % n, 'Hd',
                       set_story(H, i, s._replace(sess=3, sp=0, ws=0)), [])
            elif s.sess in (1, 2) and not fx('LOCK'):
                yield ('human: runs issue-tackle %s beside a running launch' % n, 'Hd', H,
                       [('two_sessions', 'interactive issue-tackle beside the launch')])
            if HOLD(s) and not fx('SC'):
                h = hold_keys(s)[0]
                yield ('human: deletes newest state comment on %s' % n, 'Hd',
                       set_story(H, i, s._replace(**{h: False})),
                       [('hold_released_by_non_owner', '%s released by deleting the newest state comment '
                         '(design l.71: "holds only block more")' % h)])
        if b.reo > 0 and not s.open and not b.dis:
            H = G._replace(bud=b._replace(reo=b.reo - 1))
            yield ('human: reopen %s issue' % n, 'Hd', set_story(H, i, s._replace(open=True)), [])
    # spec PR
    sp = G.spec
    if sp.pr == DRAFT:
        yield ('human: approves spec PR (exempt label) + marks ready', 'Hn',
               G._replace(spec=sp._replace(pr=READY, approved=True)), [])
    # abstraction: the spec PR's own Codex verdict is not modelled past its request (the human merges
    # on any verdict or silence); whether spec.md changed is chosen at merge
    if sp.pr == READY and sp.approved and sp.codex == 'pend':
        nrev = sp.rev + 1
        for chg in ((True, False) if sp.rescope else (False,)):
            H = G._replace(spec=sp._replace(pr=MERGED, landed=True, rev=nrev,
                                            ver=sp.ver + (1 if chg else 0),
                                            h6_rev=(nrev if sp.h6 else sp.h6_rev), h6=False, chg=False,
                                            rescope=False, codex='none', approved=False),
                           pl=G.pl._replace(phase='idle', kind=None))
            yield ('human: merges spec PR (spec.md %s)' % ('changed' if chg else 'unchanged'), 'Hn', H, [])
    if G.pl.phase == 'idle' and b.resc > 0 and sp.landed and sp.pr not in (DRAFT, READY):
        spec_card = G.par if G.par.exists else G.st[0]
        # abstraction: a rescope starts only while each story's PR is quiet (no CI/Codex verdict,
        # finding or hold yet); per-PR review noise is orthogonal to the rescope and multiplies the space
        ok = spec_card.lane in (BL, BK) and spec_card.open and (not fx('PLW') or not any(
            s.sess for s in G.st if s.exists)) and all(
            s.lane in (BL, BK) for s in G.st
            if s.exists and (s.branch or (fx('S2') and s.open and s.claimed))) and all(
            s.pr == NONE or (s.ci == 'pend' and s.codex == 'none' and s.fnd is None
                             and (RESCOPE_HELD_START or not HOLD(s)))
            for s in G.st if s.exists)
        if ok:
            H = G._replace(pl=Planner('running', 'rescope', True), bud=b._replace(resc=b.resc - 1))
            v = V()
            if fx('L4'):
                H = H._replace(spec=H.spec._replace(pr=DRAFT, approved=False, codex='none', rescope=True))
                H = place_rescope_holds(H, v)
                st = [s._replace(rr=s.rr - {'spec'}) if s.exists else s for s in H.st]
                H = H._replace(st=tuple(st))
            yield ('human: runs issue-spec (rescope)', 'Hn', H, v.items)
    if G.pl.phase == 'running' and G.pl.rev_on:
        yield ('human: types "reviewer off" in the planner session', 'Hd',
               G._replace(pl=G.pl._replace(rev_on=False)), [])
    if b.dis > 0 and sp.pr in (DRAFT, READY):
        yield ('human: closes the spec PR', 'Hd',
               G._replace(spec=sp._replace(pr=CLOSED, rescope=False), pl=G.pl._replace(phase='idle'),
                          bud=b._replace(dis=b.dis - 1)), [])
    if b.dis > 0 and G.par.exists and G.par.open and G.par.lane in (BL, BK):
        yield ('human: parent -> Ready', 'Hd',
               G._replace(par=G.par._replace(lane=RD), bud=b._replace(dis=b.dis - 1)), [])


# ---------------------------------------------------------------- external world
def external_steps(G):
    """kind 'Eg' cooperative, 'Eb' adverse, 'Eo' outsider."""
    b = G.bud
    for i, s in enumerate(G.st):
        if not s.exists or s.pr not in (DRAFT, READY):
            continue
        n = 's%d' % i

        def up(**kw):
            return set_story(G, i, s._replace(**kw))
        if s.ci == 'pend':
            yield ('CI green on %s' % n, 'Eg', up(ci='green'), [])
            yield ('CI failure on %s' % n, 'Eb', up(ci='fail'), [])
            yield ('CI pending past review_timeout on %s' % n, 'Eb', up(ci='slow'), [])
        if s.codex == 'pend':
            yield ('Codex pass on %s' % n, 'Eg', up(codex='pass'), [])
            yield ('Codex fail + threads on %s' % n, 'Eb',
                   up(codex='fail', fnd=('bot' if s.fnd in (None, 'tl_pushed') else s.fnd)), [])
            yield ('Codex out of credits (WAIVED) on %s' % n, 'Eb', up(codex='waived'), [])
        if s.codex == 'pend':
            yield ('Codex silent past timeout on %s' % n, 'Eb', up(codex='silent'), [])
        if s.codex == 'none' and not fx('SIL'):
            yield ('Codex module timeout passes unrequested on %s' % n, 'Eb', up(codex='silent'), [])
        if s.pr == READY and not s.cr:
            yield ('CodeRabbit reviews %s: nothing' % n, 'Eg', up(cr=True), [])
            if s.fnd is None:
                yield ('CodeRabbit thread on %s' % n, 'Eb', up(cr=True, fnd='bot'), [])
                yield ('CodeRabbit outside-diff item on %s' % n, 'Eb', up(cr=True, fnd='tl_open'), [])
        if s.fnd is None and b.ext > 0:
            H = G._replace(bud=b._replace(ext=b.ext - 1))
            yield ('trusted writer opens a review thread on %s' % n, 'Eb', set_story(H, i, s._replace(fnd='writer')), [])
            yield ('main moves: conflict on %s' % n, 'Eb', set_story(H, i, s._replace(fnd='conflict')), [])
        if s.fnd is None and b.outs > 0:
            H = G._replace(bud=b._replace(outs=b.outs - 1))
            yield ('outsider opens a review thread on %s' % n, 'Eo', set_story(H, i, s._replace(fnd='outsider')), [])


def crash_restart(G, survive):
    """The orchestrator dies and restarts; entries without exit are dropped (S5: marked orphan)."""
    st = list(G.st)
    for j, s in enumerate(st):
        if not s.exists:
            continue
        if s.log == 'run':
            if fx('S5'):
                s = s._replace(log='orphan', l_fp=None, l_mv=False)
            elif s.old is None:
                s = s._replace(log=None, l_nw=False, l_fp=None, l_mv=False, l_chg=False, l_pr=False,
                               l_hd=False, l_ready=False)
            else:
                nw, chg, lpr, hd = s.old
                s = s._replace(log='exit', l_nw=nw, l_chg=chg, l_pr=lpr, l_hd=hd, l_fp=None, l_mv=False,
                               old=None)
            if s.sess == 1:
                s = s._replace(sess=2 if survive else 0, sp=s.sp if survive else 0, ws=s.ws if survive else 0)
        st[j] = s
    return G._replace(st=tuple(st), bud=G.bud._replace(crash=G.bud.crash - 1))


# ---------------------------------------------------------------- transition relation
def apply_writes(G, W):
    v = V()
    for _, f in W:
        G = f(G, v)
    return G, v.items


def spurious_block_check(G, i, viols, cause):
    """A Blocked move whose bare Ready (nothing changed by the human) proceeds without a launch."""
    s = G.st[i]
    Z = set_story(G, i, s._replace(lane=RD, lane_h=True))
    W, o = tick_story(Z, i)
    if o.startswith('working:') and 'block' not in o and 'launch' not in o:
        viols.append(('spurious_blocked', '%s; a bare Ready then goes %s' % (cause, o)))


def successors(G):
    out = []
    # orchestrator
    ticks = [('tick s%d' % i, i) for i in range(len(G.st)) if G.st[i].exists]
    for name, i in ticks:
        W, o = tick_story(G, i)
        pre = G.st[i]
        if o == 'UNDEF':
            out.append(('%s [%s x %s] no defined action' % (name, pre.lane, pre.pr), 'O', G,
                        [('undefined_cell', '%s x %s (%s)' % (pre.lane, pre.pr, cell_detail(pre)))]))
        if not W:
            continue
        H, viols = apply_writes(G, W)
        viols = list(viols)
        if any(n == 'lane:' + BK for n, _ in W) and pre.lane != BK:
            spurious_block_check(H, i, viols, o)
        out.append(('%s [%s x %s]: %s' % (name, pre.lane, pre.pr, ', '.join(n for n, _ in W)), 'O', H, viols))
        if G.bud.crash > 0 and len(W) >= 2:
            for k in range(1, len(W)):
                P, v2 = apply_writes(G, W[:k])
                for survive in (False, True):
                    C = crash_restart(P, survive)
                    vv = list(v2)
                    names = [n for n, _ in W[:k]]
                    if any(n.startswith('post:') for n in names) and not any(n == 'lane:' + BK for n in names) \
                            and any(n == 'lane:' + BK for n, _ in W):
                        W2, o2 = tick_story(C, i)
                        if not any(n == 'lane:' + BK for n, _ in W2):
                            vv.append(('blocked_move_lost', 'reason posted, crash, next tick: %s' % o2))
                    out.append(('%s: %s | CRASH%s' % (name, ', '.join(names),
                                                      ' (session survives)' if survive else ''), 'X', C, vv))
    for name, fn in (('tick parent', tick_parent), ('sweep spec PR', tick_spec)):
        W, o = fn(G)
        if W:
            H, viols = apply_writes(G, W)
            out.append(('%s: %s' % (name, ', '.join(n for n, _ in W)), 'O', H, viols))
    if G.bud.crash > 0:
        for survive in (False, True):
            if survive and not any(s.sess == 1 for s in G.st):
                continue
            out.append(('orchestrator crash + restart' + (' (session survives)' if survive else ''), 'X',
                        crash_restart(G, survive), []))
    for i in range(len(G.st)):
        out.extend(session_steps(G, i))
    out.extend(planner_steps(G))
    out.extend(human_steps(G))
    out.extend(external_steps(G))
    return out


def cell_detail(s):
    return 'log=%s handled=%s exempt=%s att=%s' % (s.log, s.l_hd, s.exempt, s.att)


# ---------------------------------------------------------------- state-level checks
def state_checks(G):
    v = []
    if G.pl.phase == 'running' and G.pl.rev_on and not fx('T9'):
        v.append(('planner_commit_refused',
                  'planner session: no session issue / <p>-spec fails FENCE / lane rule refuses Backlog-Blocked'))
    return v


# ---------------------------------------------------------------- canonical form
def canon_story(s, G):
    if not s.exists:
        return s
    if s.pr in (NONE, CLOSED, MERGED):
        s = s._replace(rfr=False, req=False, codex='none', cr=False, fnd=None, pbk=False, exempt=False)
    if s.pr in (NONE, MERGED):
        s = s._replace(att=False, ci='pend')
    if s.pr == MERGED and s.sess == 0:
        s = s._replace(esc=False, pb=False, aud=False, clm=False, rsc=False, ghr=0, nl=0, lane_h=False,
                       log=None, l_nw=False, l_fp=None, l_mv=False, l_chg=False, l_pr=False, l_hd=False,
                       l_ready=False, old=None, br_rev=0, br_ver=0, rr=frozenset())
    keep = set(h for h in HOLDS if getattr(s, h))
    if CONVERTED(s):
        keep.add('conv')
    if s.pr == CLOSED:
        keep.add('clo')
    if SILENT(s):
        keep.add('sil')
    if not SPEC_LANDED(G):
        keep.add('spec')
    if s.exempt and FINDINGS(s):
        keep.add('exfind')
    if s.exempt and s.ex_stale:
        keep.add('exstale')
    if s.codex == 'fail':
        keep.add('codexfail')
    if s.nl >= 1:
        keep.add('bound')
    rr = s.rr & keep
    d = {}
    if rr != s.rr:
        d['rr'] = rr
    if not s.esc and s.esc_ans:
        d['esc_ans'] = False
    if not s.rsc and s.rsc_rec:
        d['rsc_rec'] = 0
    if not s.exempt and s.ex_stale:
        d['ex_stale'] = False
    if s.sess == 0 and (s.sp or s.ws):
        d['sp'] = 0
        d['ws'] = 0
    if s.log is None and (s.l_nw or s.l_chg or s.l_pr or s.l_hd or s.l_ready or s.old):
        d.update(l_nw=False, l_chg=False, l_pr=False, l_hd=False, l_ready=False, old=None)
    if s.log != 'run' and s.l_ready:
        d['l_ready'] = False
    if G.bud.crash == 0 and s.old is not None:
        d['old'] = None
    return s._replace(**d) if d else s


def canon(G):
    st = tuple(canon_story(s, G) for s in G.st)
    sp = G.spec
    if sp.pr not in (DRAFT, READY):
        sp = sp._replace(codex='none', approved=False, chg=False, h6=False, rescope=False)
    return G._replace(st=st, spec=sp)


# ---------------------------------------------------------------- exploration
KINDS_PROGRESS = {'O', 'S', 'P', 'Eg', 'Hn'}
KINDS_AUTO = {'O', 'S', 'P', 'Eg'}
KINDS_LOOP = {'O', 'S', 'P', 'Eg', 'Eb'}
KINDS_LOOP_OUTSIDER = KINDS_LOOP | {'Eo'}


def explore(G0, limit):
    G0 = canon(G0)
    ids = {G0: 0}
    states = [G0]
    pred = [(-1, None)]
    edges = [None]
    first_viol = {}
    q = deque([0])
    while q:
        u = q.popleft()
        if u % 200000 == 0 and u:
            sys.stderr.write('  explored %d, seen %d\n' % (u, len(states)))
        G = states[u]
        for key, det in state_checks(G):
            first_viol.setdefault(key, (u, None, det))
        es = []
        for label, kind, H, viols in successors(G):
            H = canon(H)
            if H in ids:
                w = ids[H]
            else:
                w = len(states)
                ids[H] = w
                states.append(H)
                pred.append((u, label))
                edges.append(None)
                q.append(w)
                if len(states) > limit:
                    raise RuntimeError('state limit %d exceeded' % limit)
            es.append((w, kind, label))
            for key, det in viols:
                k2 = key if key not in ('undefined_cell', 'spurious_blocked') else key + ': ' + spur_class(det)
                if k2 not in first_viol:
                    first_viol[k2] = (u, label, det)
        edges[u] = es
    return states, pred, edges, first_viol


def backward(states, edges, goal, kinds):
    n = len(states)
    rev = [[] for _ in range(n)]
    for u in range(n):
        for w, k, _ in edges[u]:
            if k in kinds:
                rev[w].append(u)
    good = bytearray(n)
    q = deque()
    for u in range(n):
        if goal(states[u]):
            good[u] = 1
            q.append(u)
    while q:
        w = q.popleft()
        for u in rev[w]:
            if not good[u]:
                good[u] = 1
                q.append(u)
    return good


def trace(states, pred, u):
    path = []
    while u != -1:
        p, lbl = pred[u]
        path.append((lbl, u))
        u = p
    path.reverse()
    return path


def story_brief(s):
    if not s.exists:
        return '-'
    hs = ','.join(h + ('(rec v%d)' % s.rsc_rec if h == 'rsc' else '') for h in hold_keys(s))
    return ('%s%s%s pr=%s%s att=%d ci=%s cx=%s fnd=%s ex=%d holds=[%s] rr=[%s] sess=%d log=%s%s br=%s' % (
        s.lane, '(h)' if s.lane_h else '', '' if s.claimed else '(unclaimed)', s.pr,
        '(rfr)' if s.rfr else '', s.att, s.ci, s.codex, s.fnd, s.exempt, hs, ','.join(sorted(s.rr)),
        s.sess, s.log, '(hd)' if s.l_hd else '',
        ('r%d/v%d' % (s.br_rev, s.br_ver)) if s.branch else 'no')) + ('' if s.open else ' CLOSED')


def brief(G):
    sp = G.spec
    return ('  s0: %s\n  s1: %s\n  parent: %s  spec: pr=%s landed=%d main r%d/v%d%s  planner: %s%s' % (
        story_brief(G.st[0]), story_brief(G.st[1]),
        ('%s %s' % (G.par.lane, 'open' if G.par.open else 'closed')) if G.par.exists else '-',
        sp.pr, sp.landed, sp.rev, sp.ver, ' (rescope)' if sp.rescope else '',
        G.pl.phase, ' reviewer-on' if G.pl.rev_on and G.pl.phase == 'running' else ''))


def print_trace(states, pred, u, extra_label=None, out=sys.stdout, full=False):
    path = trace(states, pred, u)
    for k, (lbl, w) in enumerate(path):
        if lbl is not None:
            out.write('   %2d. %s\n' % (k, lbl))
    if extra_label:
        out.write('   %2d. %s\n' % (len(path), extra_label))
    out.write(brief(states[u]) + '\n')


def find_cycles(states, edges, kinds, edge_pred):
    """Tarjan SCC over edges of the given kinds; returns SCCs with an internal edge matching edge_pred."""
    n = len(states)
    index = [-1] * n
    low = [0] * n
    onst = bytearray(n)
    stack = []
    comp = [-1] * n
    idx = 0
    ncomp = 0
    fe = [[e for e in edges[u] if e[1] in kinds] for u in range(n)]
    for root in range(n):
        if index[root] != -1:
            continue
        work = [(root, 0)]
        index[root] = low[root] = idx
        idx += 1
        stack.append(root)
        onst[root] = 1
        while work:
            u, pi = work[-1]
            es = fe[u]
            if pi < len(es):
                work[-1] = (u, pi + 1)
                w = es[pi][0]
                if index[w] == -1:
                    index[w] = low[w] = idx
                    idx += 1
                    stack.append(w)
                    onst[w] = 1
                    work.append((w, 0))
                elif onst[w]:
                    low[u] = min(low[u], index[w])
            else:
                work.pop()
                if work:
                    p = work[-1][0]
                    low[p] = min(low[p], low[u])
                if low[u] == index[u]:
                    while True:
                        w = stack.pop()
                        onst[w] = 0
                        comp[w] = ncomp
                        if w == u:
                            break
                    ncomp += 1
    found = defaultdict(list)
    for u in range(n):
        for w, k, lbl in edges[u]:
            if k in kinds and comp[u] == comp[w] and edge_pred(lbl):
                found[comp[u]].append((u, w, lbl))
    return comp, found


def cycle_path(states, edges, kinds, comp, start):
    """A shortest cycle through `start` inside its SCC (BFS back to start)."""
    c = comp[start]
    prev = {start: None}
    q = deque([start])
    while q:
        u = q.popleft()
        for w, k, lbl in edges[u]:
            if k not in kinds or comp[w] != c:
                continue
            if w == start:
                path = [lbl]
                x = u
                while prev[x] is not None:
                    pu, pl = prev[x]
                    path.append(pl)
                    x = pu
                return list(reversed(path))
            if w not in prev:
                prev[w] = (u, lbl)
                q.append(w)
    return []


# ---------------------------------------------------------------- analyses
def goal_story(i):
    def g(G):
        s = G.st[i]
        return (not s.exists) or s.pr == MERGED or not s.open
    return g


def goal_parent(G):
    return not G.par.exists or not G.par.open


def goal_planner(G):
    return G.pl.phase != 'running'


def quiescent(G, i):
    s = G.st[i]
    if s.sess != 0:
        return False
    W, _ = tick_story(G, i)
    if W:
        return False
    if G.pl.phase == 'running' and (not G.pl.rev_on or fx('T9')):
        return False
    return True


HUMAN_RELEASED = ('esc', 'pb', 'rsc')    # holds whose release needs a human act beyond a bare Ready


def classify_progress(G, i):
    s = G.st[i]
    if G.pl.phase == 'running' and G.pl.rev_on and not fx('T9'):
        return 'T9 planner commit refused: rescope/new spec never opens its spec PR'
    if s.rsc and G.spec.ver != s.rsc_rec and G.spec.pr not in (DRAFT, READY) and s.br_rev < G.spec.rev:
        return 'K1 rescope hold never released: the held-branch watch puts the merge of main back'
    if s.exempt and s.pr in (DRAFT, READY):
        return 'K12 exempt story PR: grid never tests EXEMPT (launch -> REPEAT -> Blocked, or no cell)'
    if i == 1 and G.st[0].pr == MERGED and G.st[0].open:
        return 'L6 reopened merged blocker freezes the blockedBy chain'
    if s.codex == 'fail' and not FINDINGS(s) and not s.pb and not s.pbk:
        return 'S9 codex-review failure with no findings and no hold: no cell, no named release'
    if s.pr == NONE and s.lane in (IP, IR) and s.log == 'exit' and s.l_hd:
        return 'S5 launch already HANDLED, card not Blocked (crash after the post, or drag back): no cell'
    if i == 1 and not goal_story(0)(G):
        c = classify_progress(G, 0)
        if c:
            return 'via blocker s0: ' + c
    return None


def classify_stall(G, i):
    s = G.st[i]
    if i == 1 and G.st[0].pr == MERGED and G.st[0].open:
        return 'L6 reopened merged blocker freezes the blockedBy chain'
    if s.exempt and s.pr in (DRAFT, READY):
        return 'K12 exempt story PR: grid never tests EXEMPT (launch -> REPEAT -> Blocked, or no cell)'
    miss = [h for h in hold_keys(s) if h in HUMAN_RELEASED and h not in s.rr]
    if s.esc and 'esc' not in s.rr:
        return 'S3 escalation hold open, question never posted'
    if miss:
        return 'S3 (same root) %s hold open, its reason never posted' % ','.join(miss)
    if s.codex == 'fail' and not FINDINGS(s) and not HOLD(s):
        return 'S9 codex-review failure, no findings, no hold'
    if s.pr == NONE and s.lane in (IP, IR) and s.log == 'exit' and s.l_hd:
        return 'S5 launch already HANDLED, card not Blocked (crash after the post, or drag back): no cell'
    if i == 1 and G.st[0].pr == MERGED and G.st[0].open:
        return 'L6 reopened merged blocker freezes the blockedBy chain'
    return None


def stall_reason(G, i):
    """None if the state is not a silent stall for story i; else a description."""
    s = G.st[i]
    if not s.exists or goal_story(i)(G):
        return None
    if G.pl.phase == 'running':
        return None
    if s.lane in (BL, BK) and s.lane_h:
        return None
    if s.lane in (BL, IP, IR) and not s.claimed:
        return None                 # a card a human placed without Ready: the orchestrator never claimed it
    if s.lane == RD and not BLOCKERS_CLOSED(G, i) and i == 1 and not goal_story(0)(G):
        return None
    if s.lane in (RD, IP, IR):
        return 'card in %s with nothing posted' % s.lane
    if s.lane == BK:
        missing = [h for h in hold_keys(s) if h in HUMAN_RELEASED and h not in s.rr]
        if missing:
            return 'Blocked, reason of open hold(s) %s never posted' % ','.join(missing)
        return None
    return None


def report(states, pred, edges, first_viol, out, maxtrace=2):
    n = len(states)
    found = {}
    out.write('states: %d   transitions: %d\n' % (n, sum(len(e) for e in edges)))

    # transition-level and state-level violations
    for key in sorted(first_viol):
        u, lbl, det = first_viol[key]
        found[key] = det
        out.write('\n== VIOLATION %s\n   %s\n' % (key, det))
        print_trace(states, pred, u, lbl, out)

    nstories = len(states[0].st)
    for i in range(nstories):
        if not any(G.st[i].exists for G in states[:1]) and not any(G.st[i].exists for G in states):
            continue
        if i == 1 and states[0].bud.h6:
            continue          # the H6 scenario keeps the added story in Backlog by construction
        g = goal_story(i)
        named = backward(states, edges, g, KINDS_PROGRESS)

        def done_or_informed(G, i=i, g=g):
            # the story merges, or automation alone reaches a Blocked card whose reasons are all posted
            s = G.st[i]
            return g(G) or (s.lane == BK and not s.lane_h and stall_reason(G, i) is None)
        auto = backward(states, edges, done_or_informed, KINDS_AUTO)
        groups = defaultdict(list)
        for u in range(n):
            if states[u].st[i].exists and not named[u]:
                groups[classify_progress(states[u], i) or 'UNCLASSIFIED'].append(u)
        for c, us in sorted(groups.items()):
            key = 'progress s%d: %s' % (i, c)
            found[key] = len(us)
            out.write('\n== VIOLATION %s  (%d states; no path to merge or close using design-named human actions)\n'
                      % (key, len(us)))
            for u in sorted(us, key=lambda x: depth(pred, x))[:1 if c != 'UNCLASSIFIED' else maxtrace]:
                print_trace(states, pred, u, None, out)
        groups = defaultdict(list)
        for u in range(n):
            G = states[u]
            if auto[u] or not quiescent(G, i):
                continue
            r = stall_reason(G, i)
            if r:
                groups[(classify_stall(G, i) or 'UNCLASSIFIED', r)].append(u)
        for (c, r), us in sorted(groups.items()):
            key = 'silent stall s%d: %s [%s]' % (i, c, r)
            found[key] = len(us)
            out.write('\n== VIOLATION %s  (%d states)\n' % (key, len(us)))
            for u in sorted(us, key=lambda x: depth(pred, x))[:1 if c != 'UNCLASSIFIED' else maxtrace]:
                print_trace(states, pred, u, None, out)
        # every hold has a reachable release
        for h in HOLDS:
            def gh(G, i=i, h=h):
                s = G.st[i]
                return (not s.exists) or not getattr(s, h) or s.pr == MERGED or not s.open
            rel = backward(states, edges, gh, KINDS_PROGRESS)
            us = [u for u in range(n) if not rel[u]]
            if us:
                byc = defaultdict(list)
                for u in us:
                    byc[classify_progress(states[u], i) or 'UNCLASSIFIED'].append(u)
                for c, uu in sorted(byc.items()):
                    key = 'hold %s-s%d has no reachable release: %s' % (h, i, c)
                    found[key] = len(uu)
                    out.write('\n== VIOLATION %s  (%d states)\n' % (key, len(uu)))
                    u = min(uu, key=lambda x: depth(pred, x))
                    print_trace(states, pred, u, None, out)
    if (states[0].par.exists or any(G.par.exists for G in states)) and not states[0].bud.h6:
        named = backward(states, edges, goal_parent, KINDS_PROGRESS)
        auto = backward(states, edges, goal_parent, KINDS_AUTO)
        us = [u for u in range(n) if states[u].par.exists and not named[u]]
        byc = defaultdict(list)
        for u in us:
            G = states[u]
            c = ('L6 reopened merged story keeps the parent open' if any(s.pr == MERGED and s.open for s in G.st)
                 else classify_progress(G, 0) or classify_progress(G, 1) or 'UNCLASSIFIED')
            byc[c].append(u)
        for c, uu in sorted(byc.items()):
            key = 'progress parent: %s' % c
            found[key] = len(uu)
            out.write('\n== VIOLATION %s  (%d states)\n' % (key, len(uu)))
            print_trace(states, pred, min(uu, key=lambda x: depth(pred, x)), None, out)
    named = backward(states, edges, goal_planner, KINDS_PROGRESS)
    us = [u for u in range(n) if not named[u]]
    if us:
        key = 'progress planner: spec PR never opens'
        found[key] = len(us)
        out.write('\n== VIOLATION %s  (%d states)\n' % (key, len(us)))
        print_trace(states, pred, min(us, key=lambda x: depth(pred, x)), None, out)

    # unbounded automated loops
    for kinds, tag in ((KINDS_LOOP, 'automated'), (KINDS_LOOP_OUTSIDER, 'outsider-driven')):
        comp, cyc = find_cycles(states, edges, kinds, lambda lbl: 'launch' in lbl and lbl.startswith('tick'))
        seen = {}
        for c, es in cyc.items():
            u = min((e[0] for e in es), key=lambda x: depth(pred, x))
            path = cycle_path(states, edges, kinds, comp, u)
            sig = loop_signature(path)
            if tag == 'outsider-driven' and not any('outsider' in p for p in path):
                continue
            if sig not in seen:
                seen[sig] = (u, path, len(es))
        for sig, (u, path, m) in sorted(seen.items()):
            key = 'unbounded %s launch loop: %s' % (tag, sig)
            found[key] = m
            out.write('\n== VIOLATION %s\n   reached by:\n' % key)
            print_trace(states, pred, u, None, out)
            out.write('   cycle (no human action, no counter):\n')
            for p in path:
                out.write('      -> %s\n' % p)
    return found


def loop_signature(path):
    parts = []
    for p in path:
        if p.startswith('tick'):
            p = p.split(': ', 1)[-1]
        for tok in ('internal round FIX', 'github round FIX', 'CI failure', 'Codex fail', 'CodeRabbit thread',
                    'outsider', 'launch', 'internal round CLEAN', 'session ends', 'first push', 'audit',
                    'conflict', 'CodeRabbit outside-diff', 'PUSH_BACK', 'ready flip'):
            if tok in p and tok not in parts:
                parts.append(tok)
    return ' / '.join(sorted(parts))


_depth_cache = {}


def spur_class(det):
    c = det.split(';')[0]
    if 'REPEAT' in c or c in ('block:launch', 'working:block:launch'):
        return 'S4 REPEAT blocks a launch that attested the head (%s)' % c
    if 'SILENT' in c:
        return 'SIL Codex declared silent before the orchestrator requested it (%s)' % c
    return c


def depth(pred, u):
    if u in _depth_cache:
        return _depth_cache[u]
    d = 0
    x = u
    while pred[x][0] != -1:
        x = pred[x][0]
        d += 1
    _depth_cache[u] = d
    return d


DISAGREEMENTS = [
    ("Ready x none and Ready x closed: the grid does not test an unanswered escalation; orchestrator "
     "ADR-0002 d3 sends every Ready card with one back to Blocked. Modelled: the record."),
    ("Launch from Ready: the design's Card-lanes row says reviewer releases every open hold but "
     "rescope-<s>; reviewer ADR-0013 d2 releases escalation-<s> only once ANSWERED. Modelled: the record."),
    ("Exempt story PR: the grid launches builder on any unattested PR; orchestrator ADR-0005 d3 forbids "
     "a launch on an exempt PR and names no other action. Modelled: the record (the cell is undefined); "
     "--literal-grid models the grid (launch -> REPEAT -> Blocked)."),
    ("Rescope hold placement: design Holds says 'each story issue under the spec that has a branch'; "
     "rulings H1 said 'every open story issue'. Records (reviewer 0013 d4, planner 0010 d5) say 'has a "
     "branch'. Modelled: the records."),
    ("reviewer ADR-0020 d2 watches every Bash command while 'a hold that refuses commits' is open; the "
     "design names 'the watch on a held branch' without scope. Modelled: the record."),
    "In progress x none, an exited launch already HANDLED (a human drags the Blocked card back): the grid "
    "has no cell; orchestrator ADR-0002 d6 says a drag into a working lane is 'undone when claimed'. "
    "Modelled: the grid (no action), reported as undefined_cell under S5.",
    "RUNNING after a restart: design l.82 drops every log entry without exit; l.224 says the lock lives "
    "with the launch process. Modelled: a launch that outlives the restart still holds the lock.",
    "Codex silence: SILENT (design l.223) times a module's silence from the head when there is no "
    "request (Blocked key 'the request comment, else the head'); orchestrator ADR-0008 d2 triggers Codex "
    "only once GREEN. Modelled: the design's head-timed silence (finding SIL).",
]


SUITE = [
    ('two', ''),
    ('two', 'reo=1'),
    ('two', 'crash=1'),
    ('two', 'ext=1,outs=1'),
    ('one', 'dis=1'),
    ('one', 'resc=1'),
    ('one', 'resc=1,h6=1'),
    ('new', ''),
]


def main():
    global LITERAL_GRID, RESCOPE_HELD_START
    ap = argparse.ArgumentParser()
    ap.add_argument('--variant', default='all', help='two | one | new | all')
    ap.add_argument('--rescope-held', action='store_true',
                    help='let a rescope start while a story holds a hold (larger space)')
    ap.add_argument('--fix', default='', help="comma list of fix ids, or 'all'")
    ap.add_argument('--literal-grid', action='store_true')
    ap.add_argument('--budget', default='dis=0,outs=0,crash=0,resc=0,ext=0')
    ap.add_argument('--suite', action='store_true')
    ap.add_argument('--limit', type=int, default=6_000_000)
    ap.add_argument('--notes', action='store_true')
    a = ap.parse_args()
    FIX.clear()
    if a.fix == 'all':
        FIX.update(ALL_FIXES)
    elif a.fix:
        FIX.update(x for x in a.fix.split(',') if x)
    LITERAL_GRID = a.literal_grid
    RESCOPE_HELD_START = a.rescope_held
    if a.notes:
        for d in DISAGREEMENTS:
            print('- ' + d)
        return
    def parse_b(x):
        d = dict(dis=0, outs=0, crash=0, resc=0, ext=0, reo=0, h6=0)
        for kv in x.split(','):
            if kv:
                k, v = kv.split('=')
                d[k] = int(v)
        return Budget(**d)
    if a.suite:
        runs = SUITE
    else:
        vs = ['two', 'one', 'new'] if a.variant == 'all' else [a.variant]
        runs = [(v, a.budget) for v in vs]
    print('fixes: %s   literal grid: %s' % (','.join(sorted(FIX)) or 'none', LITERAL_GRID))
    allfound = {}
    for var, bs in runs:
        _depth_cache.clear()
        G0 = initial(var, parse_b(bs))
        var = '%s[%s]' % (var, bs)
        print('\n################ scenario %s' % var, flush=True)
        states, pred, edges, fv = explore(G0, a.limit)
        found = report(states, pred, edges, fv, sys.stdout)
        for k in found:
            allfound.setdefault(k, []).append(var)
    print('\n################ SUMMARY (%s)' % (','.join(sorted(FIX)) or 'spec as written'))
    for k in sorted(allfound):
        print('  %-110s %s' % (k[:110], ','.join(allfound[k])))
    print('  total distinct: %d' % len(allfound))


if __name__ == '__main__':
    main()
