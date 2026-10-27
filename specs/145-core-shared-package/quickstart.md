# Quickstart: checking core works

Steps to check each story once it is built. None was run while planning. Needs Node 22.18 or later and npm.

## Tests (every story)

```sh
cd core
npm ci
npm test                      # tsc -p . , then node --test 'tests/**/*.test.ts'
node scripts/check-carriers.ts --base origin/main
```

The drift test fails when a file in `core/schemas/` is not what its Zod schema generates. Regenerate with `node
scripts/write-schemas.ts` and commit the result.

## US1: carrying core, and identity

1. In a scratch git repository holding a `.claude-plugin/marketplace.json`, a copy of `core/src` at `core/src`,
   and `core/tests/fixtures/carrier-plugin/` at `carrier/plugin/`, recreate its `core` link there as
   `../../core/src` (the fixture's own link, `../../../src`, points outside the copy), commit, and serve it as a
   git-hosted marketplace (research Open 1). Add it and install `carrier`.
2. Expect the installed copy under `~/.claude/plugins/cache/<marketplace>/carrier/<version>/` to hold `core/` as
   files and `node_modules/zod`. Start a session and send a prompt: the fixture's `UserPromptSubmit` hook adds
   `212` for `212-us2-retry-budget` to the context (AS1).
3. Change a file in `core/src`, commit, update the plugin without a version bump: the cached copy is unchanged.
   Bump `version`, commit, update: the new copy holds the change (AS2).
4. Delete `node_modules/zod` from the cached copy and send a prompt: the hook exits 2 naming `zod`, the prompt
   is blocked, and nothing else runs (AS3).
5. On a throwaway branch of this repo, add a carrier (`x/plugin/core` → `../../core/src`, its `package.json`,
   lockfile and `plugin.json`) and edit `core/src` without bumping it: `node scripts/check-carriers.ts --base
   origin/main` fails naming the carrier. This repo has no carrier of its own.
6. Branch grammar, from `core/`:

   ```ts
   import { parseBranch } from './src/identity.ts';
   parseBranch('212-us2-retry-budget');   // {story: 212, k: 2, slug: 'retry-budget'}
   parseBranch('145-spec');               // {spec: 145}
   parseBranch('212-us-retry');           // null
   ```

## US2: state

Against a test repo with the reviewer App installed and its story issues on a test board, with the session App's
token as reader and the reviewer App's token as writer:

```ts
import { gitHub } from './src/github.ts';
import { readState } from './src/state.ts';
const shared = (await readSettings(gitHubTree(reader, 'org/repo', 'main'))).shared;   // App logins, board
await readState(gitHub(readerToken), 'org/repo', 212, shared);
```

- On an issue with a PR and no reviewer App comment: not held, no state, not attested (AS3).
- With a token that cannot see the board: the read throws `BoardNotVisible` naming it (AS12).
- Edit the newest state comment in the GitHub UI and read again: `held` with `tampered`; `writeState` now throws
  `StateWriteRefused` naming the cause and its release (AS2, AS7).
- Post a comment as the reviewer App without the tag after a tagged one: `held` with `invalid` (AS2).
- Place an escalation hold with `placeHold`; comment as a human, then have the orchestrator App post the hold's
  question (`questionTag`), then move the card to Ready on the board: the hold is not in `releasable`. Comment
  again as a human: it is, naming that comment (AS12, AS13). A comment by a codeworks App, a move on another
  project or by a board workflow never makes it so.
- Comment `/codeworks reset` as a human: every hold placed before it is in `releasable` and `reset` names the
  comment (AS14). `releaseOnClaim` then posts one snapshot with those rows RELEASED and the rest unchanged (AS15).
- `placeRescopeHold` for spec PR #301 twice: one snapshot posted. Release it, place it for #301 again: nothing;
  for #305: the row is OPEN recording 305 (AS8).
- With the newest state comment edited, `releaseOnClaim` is refused naming the edit until a Ready move and a human
  comment both follow it; then it posts the working snapshot, rebuilt from the newest unedited one (AS7).

Attestation, in a clone of the test repo fetched to the head and `origin/main`:

```ts
import { attests } from './src/attest.ts';
await attests(clone, reading, head, 'origin/main', 'specs/145-x');
```

- With an INTERNAL round CLEAN at commit A recorded, push commit B on top: attested at B; force-push a history
  without A: not (AS11).
- Then change a `docs/adr/` file on `main`, or merge `main` into the branch and amend the merge, or release a hold
  by a human comment: not attested, `reason` naming it; release by `/codeworks reset` instead: attested (AS11).

## US3: the validator contract

From `core/`, with the fixture package and a test repo's PR:

```ts
const v = await loadValidators(settings.shared, 'tests/fixtures/validators', deps);   // validators = ["fixture"]
const m = v.modules.get('fixture');
await status(m, 'org/repo', pr, head, {timeoutSeconds: 1800, since});   // review_timeout, 30 minutes
await requiredChecks(settings.shared, reader, v).findings('org/repo', pr, head);
```

- `validators = ["nope"]`, `["Bad_Name"]` or `["threads"]`: loading throws `ValidatorLoadError` naming it (AS1).
- The fixture answering PASS for another head: PENDING; still PENDING past `since` + 1800 s: SILENT (AS2, AS3).
- The fixture throwing, or returning a finding with `source: "other"`: COULD_NOT_RUN naming it (AS4, AS5).
- On a base branch whose ruleset requires only `internal-review`, the last call returns `{outcome:
  'COULD_NOT_RUN', …}` (AS9).

## US5: tokens

On a machine with `SECURITY.md` §5's managed settings in effect, `mintToken('reviewer', appId, 'reviewer-app.pem',
'reviewer', 'org/repo')` returns a token expiring within one hour. With it, a comment on another repo's issue and
a push to `org/repo` are both refused by GitHub (SC-008). A session token's push and comment are refused too.
Remove `allowManagedHooksOnly` from the managed file: the same mint throws `KeyReadRefused` naming it, as does the
orchestrator's mint reading `session-app.pem`; reviewer's mint reading `planner-app.pem` still goes ahead (AS4).
Create `/etc/claude-code/managed-settings.d/`: the mint throws naming the folder (AS5).
