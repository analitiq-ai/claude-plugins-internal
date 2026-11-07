import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { fakeGitHub, type FakeAnswer, type FakeGitHub } from "../../core/tests/support/fake-github.ts";
import { GitHubMisanswered, GitHubPartlyAnswered, GitHubUnanswered } from "../plugin/core/github.ts";
import { MintError } from "../plugin/core/tokens.ts";
import { main } from "../plugin/scripts/preflight.ts";
import { BOARD, fakeMint, git, output, scratchCheckout, storedToken, storeToken, tempHome, writeCalls } from "./support/checkout.ts";

const OTHER_BOARD = "https://github.com/orgs/acme/projects/2";

type Issue = { state: string; cards: { url: string; status: string }[] };

function githubOf(issue: FakeAnswer, cards: FakeAnswer): FakeGitHub {
  return fakeGitHub({
    rest: { "GET /repos/acme/widgets/issues/7": issue },
    graphqlPages: [
      {
        when: (query, vars) => query.includes("projectItems") && vars.owner === "acme" && vars.name === "widgets" && vars.number === 7,
        answer: cards,
      },
    ],
  });
}

function answered({ state, cards }: Issue): FakeGitHub {
  return githubOf({ number: 7, state }, cards.map(({ url, status }) => ({ project: { url }, status: { name: status } })));
}

type Run = { code: number; stderr: string[]; github: FakeGitHub; connected: boolean; mints: string[] };

/** `alter` changes the scratch checkout before the run. */
type Options = { minutesLeft?: number | null; args?: string[]; mint?: (appId: number, repo: string) => never; alter?: (checkout: string) => void };

/** `minutesLeft` null stores no token. */
async function preflight(t: TestContext, github: FakeGitHub, options: Options = {}): Promise<Run> {
  tempHome(t);
  const { checkout } = scratchCheckout(t);
  options.alter?.(checkout);
  if (options.minutesLeft !== null) storeToken(options.minutesLeft ?? 60);
  const minting = fakeMint();
  const stderr = output();
  let connected = false;
  const code = await main(options.args ?? ["7"], {
    checkout,
    connect: (given) => {
      assert.equal(given, storedToken(), "connected with a token other than the one in planner's folder");
      connected = true;
      return github;
    },
    mint: options.mint ?? minting.mint,
    stderr: stderr.write,
  });
  assert.deepEqual(writeCalls(github.calls), [], "preflight wrote to GitHub");
  return { code, stderr: stderr.lines, github, connected, mints: minting.calls };
}

function assertStops(run: Run, ...named: string[]): void {
  assert.equal(run.code, 1, run.stderr.join("\n"));
  assert.ok(run.stderr.length > 0, "no line names the next step");
  for (const line of run.stderr) assert.match(line, /Next step: /);
  for (const part of named) assert.ok(run.stderr.join("\n").includes(part), `stderr does not name ${part}: ${run.stderr.join("\n")}`);
}

describe("preflight.ts <issue>", () => {
  for (const lane of ["Backlog", "Blocked"]) {
    it(`exits 0 for an open issue whose card on the board is in ${lane}`, async (t) => {
      const run = await preflight(t, answered({ state: "open", cards: [{ url: OTHER_BOARD, status: "Ready" }, { url: BOARD, status: lane }] }));
      assert.equal(run.code, 0, run.stderr.join("\n"));
      assert.deepEqual(run.stderr, []);
    });
  }

  for (const lane of ["Ready", "In progress", "In review", "Done"]) {
    it(`exits 1 for a card in ${lane}, naming the move to Backlog or Blocked`, async (t) => {
      const run = await preflight(t, answered({ state: "open", cards: [{ url: BOARD, status: lane }] }));
      assertStops(run, `move #7 from ${lane} to Backlog or Blocked`);
    });
  }

  it("exits 1 for an issue with no card on the board, naming the card to add", async (t) => {
    const run = await preflight(t, answered({ state: "open", cards: [{ url: OTHER_BOARD, status: "Backlog" }] }));
    assertStops(run, `add #7 to ${BOARD}`);
  });

  it("exits 1 for a closed issue, naming it", async (t) => {
    const run = await preflight(t, answered({ state: "closed", cards: [{ url: BOARD, status: "Backlog" }] }));
    assertStops(run, "#7", "closed");
  });

  it("exits 1 naming every stop that holds: a closed issue in Ready", async (t) => {
    const run = await preflight(t, answered({ state: "closed", cards: [{ url: BOARD, status: "Ready" }] }));
    assertStops(run, "closed", "move #7 from Ready to Backlog or Blocked");
    assert.equal(run.stderr.length, 2);
  });

  for (const failure of [
    new GitHubUnanswered("dummy: no answer"),
    new GitHubMisanswered("dummy: not the shape asked"),
    new GitHubPartlyAnswered("dummy: answered in part"),
  ]) {
    it(`exits 2 on a ${failure.name}, printing its message`, async (t) => {
      const run = await preflight(t, githubOf(failure, []));
      assert.equal(run.code, 2, run.stderr.join("\n"));
      assert.ok(run.stderr.join("\n").includes(failure.message), run.stderr.join("\n"));
    });
  }

  it("exits 2 naming origin for a checkout with no origin, minting nothing and calling no GitHub", async (t) => {
    const alter = (checkout: string) => git(checkout, "remote", "remove", "origin");
    const run = await preflight(t, answered({ state: "open", cards: [{ url: BOARD, status: "Backlog" }] }), { alter, minutesLeft: null });
    assert.equal(run.code, 2, run.stderr.join("\n"));
    assert.match(run.stderr.join("\n"), /remote get-url origin/);
    assert.deepEqual(run.mints, []);
    assert.deepEqual(run.github.calls, []);
  });

  for (const [what, minutesLeft] of [["no token is stored", null], ["the stored token has 9 minutes left", 9]] as const) {
    it(`mints the planner App's token once when ${what}, and checks the issue with it`, async (t) => {
      const run = await preflight(t, answered({ state: "open", cards: [{ url: BOARD, status: "Backlog" }] }), { minutesLeft });
      assert.equal(run.code, 0, run.stderr.join("\n"));
      assert.deepEqual(run.mints, ["424242 acme/widgets"]);
      assert.equal(run.connected, true);
    });
  }

  it("mints nothing while the stored token has 11 minutes left", async (t) => {
    const run = await preflight(t, answered({ state: "open", cards: [{ url: BOARD, status: "Backlog" }] }), { minutesLeft: 11 });
    assert.equal(run.code, 0, run.stderr.join("\n"));
    assert.deepEqual(run.mints, []);
  });

  it("exits 2 with core's reason when the mint is refused, and calls no GitHub", async (t) => {
    const refused = () => {
      throw new MintError("dummy refusal");
    };
    const run = await preflight(t, answered({ state: "open", cards: [{ url: BOARD, status: "Backlog" }] }), { minutesLeft: null, mint: refused });
    assert.equal(run.code, 2, run.stderr.join("\n"));
    assert.match(run.stderr.join("\n"), /mint failed: dummy refusal/);
    assert.equal(run.connected, false);
    assert.deepEqual(run.github.calls, []);
  });

  for (const args of [[], ["0"], ["07"], ["seven"], ["7", "8"]]) {
    it(`exits 2 for the arguments ${JSON.stringify(args)}, calling no GitHub`, async (t) => {
      const run = await preflight(t, answered({ state: "open", cards: [] }), { args });
      assert.equal(run.code, 2, run.stderr.join("\n"));
      assert.deepEqual(run.github.calls, []);
    });
  }
});
