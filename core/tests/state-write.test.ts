import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Gates } from "../src/contracts/gates.ts";
import type { Hold, Round, Snapshot } from "../src/contracts/snapshot.ts";
import {
  checkTransition,
  placeHold,
  placeRescopeHold,
  readState,
  recordGates,
  releaseOnClaim,
  renderState,
  stateFrom,
  StateWriteRefused,
  writeState,
  type IssueComment,
  type Opening,
} from "../src/state.ts";
import {
  BOARD,
  ISSUE,
  NOW,
  REPO,
  REVIEWER_APP,
  SHARED,
  TAG,
  adminComment,
  at,
  comment,
  deletion,
  fixRuling,
  gates,
  hold,
  lineage,
  move,
  postedSnapshot,
  posts,
  pushbackRuling,
  reader,
  releasedHold,
  round,
  sha,
  snapshot,
  stateComment,
  writer,
  type Issue,
} from "./fixtures/state/issue.ts";

// GitHub refuses a comment over this many characters.
const COMMENT_LIMIT = 65_536;

function current(state: Snapshot, more: IssueComment[] = []): Issue {
  return { comments: [stateComment(100, state, { createdAt: at("10:00") }), ...more] };
}

function refusal(pattern: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof StateWriteRefused, `expected StateWriteRefused, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  };
}

function staleRefusal(pattern: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof StateWriteRefused, `expected StateWriteRefused, got ${String(error)}`);
    assert.equal(error.release, null);
    assert.match(error.message, /a stale reading, retry from a fresh readState/);
    assert.match(error.message, pattern);
    return true;
  };
}

// Every object's keys in sorted order, and the text exactly two-space JSON of what it parses to.
function assertSortedTwoSpace(body: string): void {
  const fenced = body.slice(`${TAG}\n\`\`\`json\n`.length, -"\n```\n".length);
  const parsed: unknown = JSON.parse(fenced);
  assert.equal(fenced, JSON.stringify(parsed, null, 2), "the snapshot is not two-space JSON");
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      assert.deepEqual(keys, keys.toSorted(), `keys not sorted: ${keys.join(", ")}`);
      Object.values(value).forEach(visit);
    }
  };
  visit(parsed);
}

describe("writeState", () => {
  it("posts one comment, the tag line then the snapshot in a json fence, sorted keys, two-space indent", async () => {
    const out = writer();
    const first = snapshot({ rounds: [round(1, { at: at("09:00") })] });
    await writeState(reader({ comments: [] }), out, REPO, ISSUE, SHARED, first);
    assert.deepEqual(posts(out), [
      [
        TAG,
        "```json",
        "{",
        '  "gates": null,',
        '  "holds": [],',
        '  "pushbacks": [],',
        '  "rounds": [',
        "    {",
        `      "at": "${NOW}",`,
        `      "head": "${sha(1)}",`,
        '      "n": 1,',
        '      "result": "CLEAN",',
        '      "root_cause": null,',
        '      "stage": "INTERNAL",',
        '      "verdict": null',
        "    }",
        "  ],",
        '  "rulings": [],',
        '  "v": 1',
        "}",
        "```",
        "",
      ].join("\n"),
    ]);
  });

  it("writes every row's keys sorted at every depth, and renderState is that body", async () => {
    const old = snapshot({
      holds: [hold("pushback-212"), releasedHold("escalation-212", 90)],
      pushbacks: [{ key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 1 } }],
      rulings: [fixRuling("thread:PRRT_3", 1, [sha(1)])],
    });
    const next: Snapshot = {
      ...old,
      rounds: [...old.rounds, round(2, { result: "DIRTY", verdict: "CONVERGED_PUSHBACK", root_cause: "AT_CAUSE" })],
      pushbacks: [...old.pushbacks, { key: "thread:PRRT_2", round: { stage: "INTERNAL", n: 2 } }],
      rulings: [...old.rulings, pushbackRuling("thread:PRRT_2", 2)],
    };
    const out = writer();
    await writeState(reader(current(old)), out, REPO, ISSUE, SHARED, next);
    const [body] = posts(out);
    assertSortedTwoSpace(body);
    const stamped = { ...next, rounds: [old.rounds[0], { ...next.rounds[1], at: NOW }] };
    assert.deepEqual(postedSnapshot(body), stamped);
    assert.equal(body, renderState(stamped));
  });

  it("sets each appended round's at from now(), whatever the caller gave, and keeps the rounds before it", async () => {
    const old = snapshot({ rounds: [round(1, { at: at("09:00") })] });
    const next = { ...old, rounds: [...old.rounds, round(2, { at: "2001-01-01T00:00:00Z" }), round(3, { at: at("23:59") })] };
    const out = writer(at("12:34:56"));
    await writeState(reader(current(old)), out, REPO, ISSUE, SHARED, next);
    assert.deepEqual(
      postedSnapshot(posts(out)[0]).rounds.map((row) => row.at),
      [at("09:00"), at("12:34:56"), at("12:34:56")],
    );
  });

  it("refuses a snapshot that changes a hold row, posting nothing", async () => {
    const old = snapshot({ holds: [hold("pushback-212")] });
    const out = writer();
    const next = { ...old, holds: [] };
    await assert.rejects(writeState(reader(current(old)), out, REPO, ISSUE, SHARED, next), refusal(/pushback-212/));
    assert.deepEqual(out.calls, []);
  });

  it("refuses a snapshot that breaks its contract, posting nothing", async () => {
    const old = snapshot();
    const out = writer();
    const next = { ...old, rounds: [...old.rounds, round(1, { head: sha(7) })] };
    await assert.rejects(writeState(reader(current(old)), out, REPO, ISSUE, SHARED, next), refusal(/INTERNAL 1/));
    assert.deepEqual(posts(out), []);
  });

  it("refuses a body over 65,536 characters naming its size, and posts one of exactly 65,536", async () => {
    const old = snapshot();
    const withKey = (key: string): Snapshot => ({ ...old, pushbacks: [{ key, round: { stage: "INTERNAL", n: 1 } }] });
    const fits = "thread:".padEnd(COMMENT_LIMIT - renderState(withKey("")).length, "x");
    assert.equal(renderState(withKey(fits)).length, COMMENT_LIMIT);

    const over = writer();
    await assert.rejects(
      writeState(reader(current(old)), over, REPO, ISSUE, SHARED, withKey(`${fits}x`)),
      refusal(new RegExp(`${COMMENT_LIMIT + 1}`)),
    );
    assert.deepEqual(posts(over), []);

    const exact = writer();
    await writeState(reader(current(old)), exact, REPO, ISSUE, SHARED, withKey(fits));
    assert.equal(posts(exact)[0].length, COMMENT_LIMIT);
  });
});

describe("checkTransition", () => {
  const old = snapshot({
    rounds: [round(1), round(2)],
    holds: [hold("pushback-212"), releasedHold("escalation-212", 90)],
    pushbacks: [
      { key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 1 } },
      { key: "thread:PRRT_2", round: { stage: "INTERNAL", n: 2 } },
    ],
    rulings: [pushbackRuling("thread:PRRT_1", 1), fixRuling("thread:PRRT_4", 2, [sha(5)])],
  });
  const [pushedBack, fix] = old.rulings;

  it("lets rounds, pushbacks and rulings be appended, and nothing changed", () => {
    checkTransition(old, old);
    checkTransition(old, {
      ...old,
      rounds: [...old.rounds, round(3)],
      pushbacks: [...old.pushbacks, { key: "thread:PRRT_3", round: { stage: "INTERNAL", n: 3 } }],
      rulings: [...old.rulings, pushbackRuling("thread:PRRT_3", 3)],
    });
  });

  it("lets a FIX name the commits that fix it, after those it named", () => {
    checkTransition(old, { ...old, rulings: [pushedBack, { ...fix, commits: [sha(5), sha(6), sha(7)] }] });
  });

  const refused: Array<[string, Snapshot]> = [
    ["a round dropped", { ...old, rounds: [old.rounds[0]] }],
    ["the newest round dropped and another appended", { ...old, rounds: [old.rounds[0], round(3)] }],
    ["a round rewritten", { ...old, rounds: [old.rounds[0], { ...old.rounds[1], result: "INCOMPLETE" }] }],
    ["a round's at rewritten", { ...old, rounds: [old.rounds[0], { ...old.rounds[1], at: at("11:00") }] }],
    ["a round inserted before the newest", { ...old, rounds: [old.rounds[0], round(3), old.rounds[1]] }],
    ["a pushback dropped", { ...old, pushbacks: [old.pushbacks[1]] }],
    ["a pushback rewritten", { ...old, pushbacks: [old.pushbacks[0], { ...old.pushbacks[1], key: "thread:PRRT_X" }] }],
    ["a ruling dropped", { ...old, rulings: [fix] }],
    ["a ruling rewritten", { ...old, rulings: [{ ...pushedBack, ruling: "DEFER" }, fix] }],
    ["a ruling's reply rewritten", { ...old, rulings: [{ ...pushedBack, reply: "Moved to #301." }, fix] }],
    ["a ruling inserted before the newest", { ...old, rulings: [pushedBack, pushbackRuling("thread:PRRT_3", 2), fix] }],
    ["a FIX's commit dropped", { ...old, rulings: [pushedBack, { ...fix, commits: [] }] }],
    ["a FIX's commit replaced", { ...old, rulings: [pushedBack, { ...fix, commits: [sha(6)] }] }],
    ["a commit named before a FIX's first", { ...old, rulings: [pushedBack, { ...fix, commits: [sha(6), sha(5)] }] }],
    ["a hold row added", { ...old, holds: [...old.holds, hold("audit-212")] }],
    ["a hold row dropped", { ...old, holds: [old.holds[0]] }],
    ["a hold row released", { ...old, holds: [releasedHold("pushback-212", 91), old.holds[1]] }],
    ["a released hold row reopened", { ...old, holds: [old.holds[0], hold("escalation-212")] }],
    ["a gates section written", { ...old, gates: gates() }],
  ];
  for (const [what, next] of refused) {
    it(`refuses ${what}`, () => {
      assert.throws(() => checkTransition(old, next), StateWriteRefused);
    });
  }

  it("refuses a gates change as a stale reading to retry, naming recordGates", () => {
    const gated = { ...old, gates: gates() };
    for (const next of [old, { ...gated, gates: gates({ lineages: [lineage("L7")] }) }]) {
      assert.throws(() => checkTransition(gated, next), staleRefusal(/recordGates/));
    }
  });

  it("refuses a hold row change as a stale reading to retry, naming the calls that change hold rows", () => {
    assert.throws(
      () => checkTransition(old, { ...old, holds: [...old.holds, hold("audit-212")] }),
      staleRefusal(/placeHold, placeRescopeHold, recordGates and releaseOnClaim/),
    );
  });
});

describe("every write but the release path is refused while a tamper cause stands", () => {
  const old = snapshot();
  const causes: Array<[string, Issue, RegExp]> = [
    ["tampered", { comments: [stateComment(100, old, { lastEditedAt: at("10:30") })] }, /tampered/],
    ["deleted", { comments: [stateComment(100, old)], deletions: [deletion("10:40")] }, /deleted/],
    ["invalid", { comments: [stateComment(90, old), comment(100, REVIEWER_APP, "no tag", { createdAt: at("10:15") })] }, /invalid/],
  ];
  const writes: Array<[string, (issue: Issue, out: ReturnType<typeof writer>) => Promise<void>]> = [
    ["writeState", (issue, out) => writeState(reader(issue), out, REPO, ISSUE, SHARED, { ...old, rounds: [...old.rounds, round(2)] })],
    ["placeHold", (issue, out) => placeHold(reader(issue), out, REPO, ISSUE, SHARED, { id: "pushback-212", kind: "pushback", question: null })],
    ["placeRescopeHold", (issue, out) => placeRescopeHold(reader(issue), out, REPO, ISSUE, SHARED, 301)],
    [
      "recordGates",
      async (issue, out) => recordGates(reader(issue), out, REPO, ISSUE, SHARED, await readState(reader(issue), REPO, ISSUE, SHARED), gates(), []),
    ],
  ];
  const tamperedAt: Record<string, string> = { tampered: at("10:30"), deleted: at("10:40"), invalid: at("10:15") };

  for (const [name, issue, cause] of causes) {
    for (const [write, call] of writes) {
      it(`${write} is refused while ${name} stands, naming it and its release`, async () => {
        const out = writer();
        await assert.rejects(call(issue, out), (error: unknown) => {
          assert.ok(error instanceof StateWriteRefused, `expected StateWriteRefused, got ${String(error)}`);
          assert.match(error.message, cause);
          assert.ok(error.message.includes(BOARD), error.message);
          assert.ok(error.message.includes(tamperedAt[name]), error.message);
          assert.match(String(error.release), /Ready/);
          return true;
        });
        assert.deepEqual(out.calls, []);
      });

      it(`${write} is refused while ${name} stands even once its release holds`, async () => {
        const out = writer();
        const released = { ...issue, comments: [...issue.comments, adminComment(201, "10:50")], moves: [move("11:00")] };
        await assert.rejects(call(released, out), refusal(cause));
        assert.deepEqual(out.calls, []);
      });
    }
  }
});

describe("placeHold", () => {
  it("adds the row OPEN with since from now(), every other row unchanged", async () => {
    const old = snapshot({ holds: [releasedHold("escalation-212", 90)] });
    const out = writer();
    await placeHold(reader(current(old)), out, REPO, ISSUE, SHARED, { id: "pushback-212", kind: "pushback", question: null });
    const added: Hold = {
      id: "pushback-212",
      kind: "pushback",
      state: "OPEN",
      since: NOW,
      released: null,
      released_by: null,
      question: null,
      spec_pr: null,
    };
    assert.deepEqual(postedSnapshot(posts(out)[0]), { ...old, holds: [...old.holds, added] });
  });

  it("places a first hold on an issue with no state", async () => {
    const out = writer();
    await placeHold(reader({ comments: [] }), out, REPO, ISSUE, SHARED, { id: "audit-212", kind: "audit", question: null });
    assert.deepEqual(postedSnapshot(posts(out)[0]), {
      v: 1,
      rounds: [],
      holds: [hold("audit-212", { since: NOW })],
      pushbacks: [],
      rulings: [],
      gates: null,
    });
  });

  it("moves a RELEASED row to OPEN in its place with a new since and question, released and released_by cleared", async () => {
    const old = snapshot({ holds: [releasedHold("escalation-212", 90, { since: at("08:00") }), hold("pushback-212")] });
    const out = writer();
    await placeHold(reader(current(old)), out, REPO, ISSUE, SHARED, { id: "escalation-212", kind: "escalation", question: "Retry or fail?" });
    const reopened = hold("escalation-212", { since: NOW, question: "Retry or fail?" });
    assert.deepEqual(postedSnapshot(posts(out)[0]), { ...old, holds: [reopened, old.holds[1]] });
  });

  it("posts nothing on an OPEN row", async () => {
    const old = snapshot({ holds: [hold("escalation-212")] });
    const out = writer();
    await placeHold(reader(current(old)), out, REPO, ISSUE, SHARED, { id: "escalation-212", kind: "escalation", question: "Again?" });
    assert.deepEqual(out.calls, []);
  });

  for (const kind of ["claim", "shim"] as const) {
    it(`refuses kind ${kind}, naming recordGates, posting nothing`, async () => {
      const out = writer();
      const question = kind === "claim" ? "Why?" : null;
      await assert.rejects(
        placeHold(reader(current(snapshot())), out, REPO, ISSUE, SHARED, { id: `${kind}-L7`, kind, question }),
        refusal(/recordGates/),
      );
      assert.deepEqual(out.calls, []);
    });
  }

  it("refuses kind rescope, naming placeRescopeHold", async () => {
    const out = writer();
    await assert.rejects(
      placeHold(reader(current(snapshot())), out, REPO, ISSUE, SHARED, { id: "rescope-212", kind: "rescope", question: null }),
      refusal(/placeRescopeHold/),
    );
    assert.deepEqual(out.calls, []);
  });

  for (const question of [null, ""]) {
    it(`refuses an escalation with question ${JSON.stringify(question)}`, async () => {
      const out = writer();
      await assert.rejects(
        placeHold(reader(current(snapshot())), out, REPO, ISSUE, SHARED, { id: "escalation-212", kind: "escalation", question }),
        refusal(/question/),
      );
      assert.deepEqual(out.calls, []);
    });
  }

  it("refuses a question on a kind that has none", async () => {
    const out = writer();
    await assert.rejects(
      placeHold(reader(current(snapshot())), out, REPO, ISSUE, SHARED, { id: "pushback-212", kind: "pushback", question: "Why?" }),
      refusal(/question/),
    );
    assert.deepEqual(posts(out), []);
  });
});

describe("placeRescopeHold", () => {
  function rescope(fields: Partial<Hold>): Hold {
    return hold("rescope-212", fields);
  }

  async function place(old: Snapshot | null, specPr: number | null): Promise<Snapshot | null> {
    const out = writer();
    await placeRescopeHold(reader(old === null ? { comments: [] } : current(old)), out, REPO, ISSUE, SHARED, specPr);
    const bodies = posts(out);
    assert.ok(bodies.length <= 1, "at most one comment is posted");
    return bodies.length === 0 ? null : postedSnapshot(bodies[0]);
  }

  it("for spec PR #301 on 212 posts one snapshot with rescope-212 OPEN recording 301", async () => {
    const old = snapshot({ holds: [hold("pushback-212")] });
    assert.deepEqual(await place(old, 301), { ...old, holds: [...old.holds, rescope({ since: NOW, spec_pr: 301 })] });
  });

  it("for #301 again posts nothing, open or released", async () => {
    assert.equal(await place(snapshot({ holds: [rescope({ spec_pr: 301 })] }), 301), null);
    assert.equal(await place(snapshot({ holds: [releasedHold("rescope-212", 90, { spec_pr: 301 })] }), 301), null);
  });

  it("released, then for #305, sets the row OPEN recording 305", async () => {
    const old = snapshot({ holds: [releasedHold("rescope-212", 90, { spec_pr: 301 })] });
    assert.deepEqual(await place(old, 305), { ...old, holds: [rescope({ since: NOW, spec_pr: 305 })] });
  });

  it("placed by a RESCOPE verdict, then for #301 while OPEN, records 301 with since from now()", async () => {
    const old = snapshot({ holds: [rescope({ since: at("10:00"), spec_pr: null })] });
    assert.deepEqual(await place(old, 301), { ...old, holds: [rescope({ since: NOW, spec_pr: 301 })] });
  });

  it("on a RESCOPE verdict places the row as placeHold does: added or reopened recording no spec PR, nothing on an OPEN row", async () => {
    assert.deepEqual(await place(null, null), {
      v: 1,
      rounds: [],
      holds: [rescope({ since: NOW, spec_pr: null })],
      pushbacks: [],
      rulings: [],
      gates: null,
    });
    const released = snapshot({ holds: [releasedHold("rescope-212", 90, { spec_pr: null })] });
    assert.deepEqual(await place(released, null), { ...released, holds: [rescope({ since: NOW, spec_pr: null })] });
    assert.equal(await place(snapshot({ holds: [rescope({ spec_pr: null })] }), null), null);
    assert.equal(await place(snapshot({ holds: [rescope({ spec_pr: 301 })] }), null), null);
  });
});

describe("releaseOnClaim", () => {
  const holds = [
    hold("pushback-212", { since: at("10:00") }),
    hold("escalation-212", { since: at("10:00") }),
    hold("audit-212", { since: at("10:00") }),
    releasedHold("claim-L7", 80, { since: at("08:00"), released: at("08:30") }),
  ];
  const old = snapshot({ holds, pushbacks: [{ key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 1 } }] });

  it("posts one snapshot with every releasable hold RELEASED by its comment, every other row unchanged", async () => {
    const out = writer();
    const issue: Issue = { comments: [stateComment(100, old, { createdAt: at("10:00") }), adminComment(201, "10:30")], moves: [move("11:00")] };
    const answer = await releaseOnClaim(reader(issue), out, REPO, ISSUE, SHARED);
    const bodies = posts(out);
    assert.equal(bodies.length, 1);
    const releasedBy = { comment: 201, reset: false };
    assert.deepEqual(postedSnapshot(bodies[0]), {
      ...old,
      holds: [
        { ...holds[0], state: "RELEASED", released: NOW, released_by: releasedBy },
        holds[1],
        { ...holds[2], state: "RELEASED", released: NOW, released_by: releasedBy },
        holds[3],
      ],
    });
    const by = { id: 201, url: issue.comments[1].url, at: at("10:30") };
    assert.deepEqual(answer, {
      released: [
        { id: "pushback-212", comment: by, reset: false },
        { id: "audit-212", comment: by, reset: false },
      ],
      rebuilt: false,
      reset: null,
    });
  });

  it("records a reset's release as a reset", async () => {
    const out = writer();
    const reset = adminComment(300, "10:30", "/codeworks reset");
    const answer = await releaseOnClaim(reader(current(old, [reset])), out, REPO, ISSUE, SHARED);
    const posted = postedSnapshot(posts(out)[0]);
    assert.deepEqual(
      posted.holds.map((row) => row.released_by),
      [{ comment: 300, reset: true }, { comment: 300, reset: true }, { comment: 300, reset: true }, holds[3].released_by],
    );
    assert.deepEqual(answer.reset, { url: reset.url, at: reset.createdAt });
  });

  it("with a released tamper cause and no open hold, posts the rebuilt working snapshot, its gates with its holds", async () => {
    const working = snapshot({
      rounds: [round(1), round(2)],
      holds: [releasedHold("claim-L7", 80)],
      gates: gates({ lineages: [lineage("L7")] }),
    });
    const out = writer();
    const issue: Issue = {
      comments: [
        stateComment(90, working, { createdAt: at("09:00") }),
        stateComment(100, snapshot({ rounds: [round(1), round(2), round(3)], gates: gates() }), { lastEditedAt: at("10:30") }),
        adminComment(201, "10:45"),
      ],
      moves: [move("11:00")],
    };
    const answer = await releaseOnClaim(reader(issue), out, REPO, ISSUE, SHARED);
    assert.deepEqual(answer, { released: [], rebuilt: true, reset: null });
    assert.deepEqual(postedSnapshot(posts(out)[0]), working);
  });

  it("posts nothing when it releases no hold and no tamper cause", async () => {
    const out = writer();
    const answer = await releaseOnClaim(reader(current(old)), out, REPO, ISSUE, SHARED);
    assert.deepEqual(answer, { released: [], rebuilt: false, reset: null });
    assert.deepEqual(out.calls, []);
  });

  it("is refused while a tamper cause stands unreleased, naming it", async () => {
    const out = writer();
    const issue: Issue = { comments: [stateComment(100, old, { lastEditedAt: at("10:30") }), adminComment(201, "10:20")], moves: [move("11:00")] };
    await assert.rejects(releaseOnClaim(reader(issue), out, REPO, ISSUE, SHARED), refusal(/tampered/));
    assert.deepEqual(out.calls, []);
  });

  it("decides and writes over one read and one now()", async () => {
    const issue: Issue = { comments: [stateComment(100, old, { createdAt: at("10:00") }), adminComment(201, "10:30")], moves: [move("11:00")] };
    const read = reader(issue);
    const out = writer();
    await releaseOnClaim(read, out, REPO, ISSUE, SHARED);
    assert.deepEqual(
      read.calls.map((call) => call.kind),
      ["graphqlPages", "graphqlPages", "graphqlPages", "rest"],
      "the issue's three reads, then the one commenter's role",
    );
    assert.deepEqual(
      out.calls.map((call) => call.kind),
      ["now", "rest"],
    );
  });
});

describe("every write refuses an issue that is no issue number before asking GitHub", () => {
  const writes: Array<[string, (read: ReturnType<typeof reader>, out: ReturnType<typeof writer>, issue: number) => Promise<unknown>]> = [
    ["writeState", (read, out, issue) => writeState(read, out, REPO, issue, SHARED, snapshot())],
    ["placeHold", (read, out, issue) => placeHold(read, out, REPO, issue, SHARED, { id: "pushback-212", kind: "pushback", question: null })],
    ["placeRescopeHold", (read, out, issue) => placeRescopeHold(read, out, REPO, issue, SHARED, 301)],
    ["releaseOnClaim", (read, out, issue) => releaseOnClaim(read, out, REPO, issue, SHARED)],
    ["recordGates", (read, out, issue) => recordGates(read, out, REPO, issue, SHARED, stateFrom([], [], [], new Set(), SHARED), gates(), [])],
  ];

  for (const [write, call] of writes) {
    it(`${write} throws TypeError for 0, -1, 1.5 and NaN, with no call on either client`, async () => {
      for (const issue of [0, -1, 1.5, Number.NaN]) {
        const read = reader(current(snapshot()));
        const out = writer();
        await assert.rejects(call(read, out, issue), (error: unknown) => {
          assert.ok(error instanceof TypeError, `expected TypeError for ${issue}, got ${String(error)}`);
          assert.match(error.message, /not an issue number/);
          return true;
        });
        assert.deepEqual([...read.calls, ...out.calls], []);
      }
    });
  }
});

describe("every write but recordGates posts the gates it read", () => {
  const section = gates({ lineages: [lineage("L7")] });
  const old = snapshot({ gates: section, holds: [hold("pushback-212", { since: at("10:00") })] });

  it("writeState refuses a snapshot whose gates are not the ones it read as a stale reading to retry, posting nothing", async () => {
    for (const changed of [null, gates()]) {
      const out = writer();
      const next = { ...old, rounds: [...old.rounds, round(2)], gates: changed };
      await assert.rejects(writeState(reader(current(old)), out, REPO, ISSUE, SHARED, next), staleRefusal(/recordGates/));
      assert.deepEqual(out.calls, []);
    }
  });

  const released: Issue = { comments: [stateComment(100, old, { createdAt: at("10:00") }), adminComment(201, "10:30")], moves: [move("11:00")] };
  const writes: Array<[string, Issue, (issue: Issue, out: ReturnType<typeof writer>) => Promise<unknown>]> = [
    ["writeState", current(old), (issue, out) => writeState(reader(issue), out, REPO, ISSUE, SHARED, { ...old, rounds: [...old.rounds, round(2)] })],
    ["placeHold", current(old), (issue, out) => placeHold(reader(issue), out, REPO, ISSUE, SHARED, { id: "audit-212", kind: "audit", question: null })],
    ["placeRescopeHold", current(old), (issue, out) => placeRescopeHold(reader(issue), out, REPO, ISSUE, SHARED, 301)],
    ["releaseOnClaim", released, (issue, out) => releaseOnClaim(reader(issue), out, REPO, ISSUE, SHARED)],
  ];
  for (const [write, issue, call] of writes) {
    it(`${write} posts the gates it read`, async () => {
      const out = writer();
      await call(issue, out);
      assert.deepEqual(postedSnapshot(posts(out)[0]).gates, section);
    });
  }
});

describe("recordGates", () => {
  const before = gates({ lineages: [lineage("L6")] });
  const after = gates({ lineages: [lineage("L6"), lineage("L7")] });
  const question = "Line 4 says parse refuses a null header; parse(null) returns {}.";

  async function record(issue: Issue, next: Gates, openings: Opening[]): Promise<Snapshot> {
    const read = await readState(reader(issue), REPO, ISSUE, SHARED);
    const out = writer();
    await recordGates(reader(issue), out, REPO, ISSUE, SHARED, read, next, openings);
    const bodies = posts(out);
    assert.equal(bodies.length, 1, "one comment is posted");
    return postedSnapshot(bodies[0]);
  }

  async function refused(issue: Issue, next: Gates, openings: Opening[], check: (error: unknown) => boolean): Promise<void> {
    const read = await readState(reader(issue), REPO, ISSUE, SHARED);
    const out = writer();
    await assert.rejects(recordGates(reader(issue), out, REPO, ISSUE, SHARED, read, next, openings), check);
    assert.deepEqual(out.calls, []);
  }

  it("posts one snapshot with gates replaced and each opening placed, a claim- opening carrying its question", async () => {
    const old = snapshot({ gates: before, holds: [hold("pushback-212")] });
    const posted = await record(current(old), after, [
      { id: "claim-L7", question },
      { id: "shim-B3", question: null },
    ]);
    assert.deepEqual(posted, {
      ...old,
      gates: after,
      holds: [old.holds[0], hold("claim-L7", { since: NOW, question }), hold("shim-B3", { since: NOW })],
    });
  });

  it("posts the gates change and leaves an OPEN row as it is", async () => {
    const old = snapshot({ gates: before, holds: [hold("claim-L7", { question: "Asked before?" })] });
    assert.deepEqual(await record(current(old), after, [{ id: "claim-L7", question }]), { ...old, gates: after });
  });

  it("reopens a RELEASED row in its place with a new since and question, still one row per id", async () => {
    const old = snapshot({ gates: before, holds: [releasedHold("claim-L7", 90, { since: at("08:00") }), hold("pushback-212")] });
    assert.deepEqual(await record(current(old), after, [{ id: "claim-L7", question }]), {
      ...old,
      gates: after,
      holds: [hold("claim-L7", { since: NOW, question }), old.holds[1]],
    });
  });

  it("writes the first state of an issue with none", async () => {
    assert.deepEqual(await record({ comments: [] }, after, [{ id: "shim-B3", question: null }]), {
      v: 1,
      rounds: [],
      holds: [hold("shim-B3", { since: NOW })],
      pushbacks: [],
      rulings: [],
      gates: after,
    });
  });

  it("keeps the rounds and holds written since its reading, when the gates on GitHub are still the reading's", async () => {
    const old = snapshot({ gates: before });
    const read = await readState(reader(current(old)), REPO, ISSUE, SHARED);
    const newer = { ...old, rounds: [...old.rounds, round(2)], holds: [hold("pushback-212")] };
    const issue: Issue = { comments: [stateComment(100, old), stateComment(101, newer, { createdAt: at("10:05") })] };
    const out = writer();
    await recordGates(reader(issue), out, REPO, ISSUE, SHARED, read, after, []);
    assert.deepEqual(postedSnapshot(posts(out)[0]), { ...newer, gates: after });
  });

  it("stamps each time from GitHub's clock: a check the reading holds keeps its time, any other takes now", async () => {
    const forged = at("23:59");
    const tree = (n: number, time: string) => ({ tree: sha(n), at: time });
    const bug = (id: string, members: Gates["bugs"][number]["members"], absorbed: Gates["bugs"][number]["absorbed"] = []): Gates["bugs"][number] => ({
      id,
      members,
      absorbed,
      ranges: [],
      deep: null,
      rulings: [],
    });
    const entry = (ref: number, claim: string, time: string) => ({ ...lineage("L6").chain[0], ref: sha(ref), claim, at: time });
    const read = gates({
      lineages: [lineage("L6", { chain: [entry(1, "c1", at("09:00"))] })],
      bugs: [bug("B3", [tree(2, at("09:10"))]), bug("B4", [tree(6, at("09:20"))])],
    });
    // B4 merges into B3: its tree moves to B3's absorbed.
    const next = gates({
      lineages: [
        lineage("L6", { chain: [entry(1, "c1", forged), entry(3, "c1", forged)] }),
        lineage("L7", { chain: [entry(1, "c2", forged), entry(3, "c2", forged)] }),
      ],
      bugs: [bug("B3", [tree(2, forged), tree(4, forged)], [tree(6, forged), tree(5, forged)])],
    });
    const posted = await record(current(snapshot({ gates: read })), next, []);
    assert.deepEqual(posted.gates, {
      ...next,
      lineages: [
        lineage("L6", { chain: [entry(1, "c1", at("09:00")), entry(3, "c1", NOW)] }),
        lineage("L7", { chain: [entry(1, "c2", at("09:00")), entry(3, "c2", NOW)] }),
      ],
      bugs: [bug("B3", [tree(2, at("09:10")), tree(4, NOW)], [tree(6, at("09:20")), tree(5, NOW)])],
    });
  });

  const stale: Array<[string, Issue, Issue]> = [
    ["a newer section", current(snapshot({ gates: before })), current(snapshot({ gates: gates() }))],
    ["a first section", { comments: [] }, current(snapshot({ gates: before }))],
  ];
  for (const [what, then, now] of stale) {
    it(`refuses a stale reading to retry, posting nothing: ${what} was written since`, async () => {
      const read = await readState(reader(then), REPO, ISSUE, SHARED);
      const out = writer();
      await assert.rejects(recordGates(reader(now), out, REPO, ISSUE, SHARED, read, after, []), staleRefusal(/gates/));
      assert.deepEqual(out.calls, []);
    });
  }

  for (const id of ["pushback-212", "escalation-212", "audit-212", "rescope-212"]) {
    it(`refuses an opening of ${id}, naming it, posting nothing`, async () => {
      await refused(current(snapshot({ gates: before })), after, [{ id, question: null }], refusal(new RegExp(id)));
    });
  }

  const broken: Array<[string, Gates, Opening[]]> = [
    ["an anchor that is no sha", { ...after, anchor: "HEAD" }, []],
    ["a claim- opening without its question", after, [{ id: "claim-L7", question: null }]],
    ["a shim- opening with a question", after, [{ id: "shim-B3", question: "Why?" }]],
  ];
  for (const [what, next, openings] of broken) {
    it(`refuses ${what}, which breaks the contract, posting nothing`, async () => {
      await refused(current(snapshot({ gates: before })), next, openings, refusal(/contract/));
    });
  }

  // The contract's largest release and round, spelt out so core is graded against it: a DIRTY round, whose verdict
  // outweighs any other result's null, the longest value of every other set, the largest integer, and a time, whose
  // width is fixed.
  function reserved(state: Snapshot): Snapshot {
    const releasedBy = { comment: Number.MAX_SAFE_INTEGER, reset: false };
    const holds = state.holds.map((row): Hold =>
      row.state === "OPEN" ? { ...row, state: "RELEASED", released: NOW, released_by: releasedBy } : row,
    );
    const largest: Round = {
      stage: "INTERNAL",
      n: Number.MAX_SAFE_INTEGER,
      head: sha(1),
      result: "DIRTY",
      verdict: "CONVERGED_PUSHBACK",
      root_cause: "NOT_APPLICABLE",
      at: NOW,
    };
    return { ...state, holds, rounds: [...state.rounds, largest] };
  }

  it("refuses unless the snapshot fits with every OPEN hold released and one more largest round, naming size, reserve and limit", async () => {
    const old = snapshot({ gates: before, holds: [hold("pushback-212"), hold("claim-L5"), releasedHold("audit-212", 90)] });
    const openings: Opening[] = [{ id: "shim-B3", question: null }];
    const withWords = (words: string): Gates => gates({ lineages: [lineage("L7", { chain: [{ ...lineage("L7").chain[0], words }] })] });
    const posted = (words: string): Snapshot => ({ ...old, gates: withWords(words), holds: [...old.holds, hold("shim-B3", { since: NOW })] });
    const reserve = renderState(reserved(posted(""))).length - renderState(posted("")).length;
    const fits = "".padEnd(COMMENT_LIMIT - reserve - renderState(posted("")).length, "x");
    assert.equal(renderState(posted(fits)).length, COMMENT_LIMIT - reserve);

    await refused(current(old), withWords(`${fits}x`), openings, (error: unknown) => {
      assert.ok(error instanceof StateWriteRefused, `expected StateWriteRefused, got ${String(error)}`);
      for (const n of [COMMENT_LIMIT - reserve + 1, reserve, COMMENT_LIMIT]) {
        assert.ok(error.message.includes(String(n)), `${n} is not named: ${error.message}`);
      }
      return true;
    });
    assert.equal(renderState(await record(current(old), withWords(fits), openings)), renderState(posted(fits)));
  });
});
