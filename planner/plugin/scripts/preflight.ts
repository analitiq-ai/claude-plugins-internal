// Anything this script needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs. Type imports are erased, so they load nothing.
import "../lib/guarded.ts";

import type { GitHubClient } from "../core/github.ts";
import type { Mint } from "../lib/github.ts";

const { z } = await import("zod");
const { laneOf, LaneRefused } = await import("../core/board.ts");
const { GhFolderRefused } = await import("../core/gh-config.ts");
const { answerOf, gitHub, GitHubRefused, GitHubUnanswered, RemoteRefused } = await import("../core/github.ts");
const { KeyReadRefused } = await import("../core/keys.ts");
const { SettingsError } = await import("../core/settings.ts");
const { MintError } = await import("../core/tokens.ts");
const { Lane } = await import("../core/values.ts");
const { mintPlannerToken, NoOrigin, originRepository, plannerGitHub } = await import("../lib/github.ts");
const { readPlannerSettings } = await import("../lib/settings.ts");

export type PreflightIo = {
  /** Any folder of the checkout: the workflow runs its steps in the project, which may be one below the root. */
  checkout: string;
  connect: (token: string) => GitHubClient;
  mint: Mint;
  stderr: (line: string) => void;
};

// Root ADR-0006 d1: planner works on an issue only where builder and reviewer never do.
const PLANNING_LANES: readonly string[] = [Lane.schema.enum.Backlog, Lane.schema.enum.Blocked];
const ISSUE_ARGUMENT = /^[1-9][0-9]*$/;
const IssueState = z.object({ state: z.enum(["open", "closed"]) });

/** Exit 0 when the run may start, 1 naming each stop's next step, 2 when it could not be checked. */
export async function main(args: readonly string[], io: PreflightIo): Promise<number> {
  if (args.length !== 1 || !ISSUE_ARGUMENT.test(args[0]) || !Number.isSafeInteger(Number(args[0]))) {
    io.stderr(`planner: preflight.ts takes one argument, the issue number, not ${JSON.stringify(args)}`);
    return 2;
  }
  const issue = Number(args[0]);
  try {
    const repo = await originRepository(io.checkout);
    const settings = await readPlannerSettings(io.checkout);
    const { shared } = settings;
    const github = await plannerGitHub(repo, settings, io.connect, new Date(), io.mint);
    const name = `${repo.owner}/${repo.name}`;
    const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${issue}`;
    const { state } = answerOf(IssueState, await github.rest("GET", path), `${name}#${issue}`);
    const lane = await laneOf(github, name, issue, shared.board);

    const stops: string[] = [];
    // Root ADR-0006 d3: new work on a closed issue goes in a new issue.
    if (state === "closed") stops.push(`#${issue} is closed. Next step: scope the work in a new issue.`);
    if (lane === null) stops.push(`#${issue} has no card on ${shared.board}. Next step: add #${issue} to ${shared.board}.`);
    else if (!PLANNING_LANES.includes(lane)) {
      stops.push(`#${issue}'s card is in ${lane}. Next step: move #${issue} from ${lane} to ${PLANNING_LANES.join(" or ")}.`);
    }
    for (const stop of stops) io.stderr(stop);
    return stops.length === 0 ? 0 : 1;
  } catch (error) {
    if (
      !(
        error instanceof GitHubUnanswered ||
        error instanceof GitHubRefused ||
        error instanceof SettingsError ||
        error instanceof RemoteRefused ||
        error instanceof NoOrigin ||
        error instanceof GhFolderRefused ||
        error instanceof KeyReadRefused ||
        error instanceof MintError ||
        error instanceof LaneRefused
      )
    ) {
      throw error;
    }
    io.stderr(`planner: ${error.message}`);
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), {
    checkout: process.cwd(),
    connect: (token) => gitHub(token),
    mint: mintPlannerToken,
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
