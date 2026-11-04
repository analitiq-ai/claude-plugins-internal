import { event, eventCommit, fakeLedger, invalidCommit, type FakeLedger } from "../../../core/tests/fixtures/state/ledger.ts";
import { fakeGitHub, type FakeCall, type FakeGitHub } from "../../../core/tests/support/fake-github.ts";
import type { Shared } from "../../plugin/core/settings.ts";
import { round } from "../../../core/tests/fixtures/state/issue.ts";
import type { IssueComment } from "../../plugin/core/state.ts";
import { Lane } from "../../plugin/core/values.ts";
import { BOARD, contentsAnswer, ORCHESTRATOR_LOGIN, SESSION_LOGIN, SETTINGS } from "./checkout.ts";

export const SHARED: Shared = {
  board: BOARD,
  validators: [],
  adr_folders: [],
  session_app_login: SESSION_LOGIN,
  orchestrator_app_login: ORCHESTRATOR_LOGIN,
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};

const REPO_ID = "R_widgets";
const NAME_WITH_OWNER = "acme/widgets";
export const GITHUB_NOW = "2026-10-30T12:00:00Z";

/** What GitHub holds of story `story`; each other issue named is done only when listed in `doneIssues`. */
export type Story = {
  story: number;
  /** Null: the issue has no card on the board. */
  lane: Lane | null;
  blockers: number[];
  /** The spec's issue, the story's parent; null when the story is its own. */
  parent: number | null;
  /** The PRs on `<p>-spec`. */
  specPrs: { number: number; closed: boolean; merged: boolean }[];
  subIssues: number[];
  doneIssues: number[];
  comments: IssueComment[];
  /** The repository's `ledger` branch. */
  ledger: FakeLedger;
};

/** A `ledger` that holds another story's round and nothing of this one's. */
export function quietLedger(): FakeLedger {
  const ledger = fakeLedger();
  eventCommit(ledger, [event.round(round(1))], { issue: 7 });
  return ledger;
}

export const READY_STORY: Story = {
  story: 212,
  lane: "Ready",
  blockers: [201],
  parent: 200,
  specPrs: [{ number: 31, closed: true, merged: true }],
  subIssues: [],
  doneIssues: [201],
  comments: [],
  ledger: quietLedger(),
};

/** A `ledger` with an unsigned commit to story 212. */
export function tamperedLedger(): FakeLedger {
  const ledger = quietLedger();
  invalidCommit(ledger, { put: { "round.run-1.json": "{}\n" } });
  return ledger;
}

const optionId = (lane: Lane) => `option-${lane}`;

function related(numbers: number[]) {
  return numbers.map((number) => ({ number, repository: { id: REPO_ID, nameWithOwner: NAME_WITH_OWNER } }));
}

// A merged PR from the issue's own story branch is what core reads as done.
function doneTimeline(issue: number) {
  const pr = { __typename: "PullRequest", number: 5000 + issue, headRefName: `${issue}-us1-done`, merged: true, isCrossRepository: false };
  return [{ __typename: "CrossReferencedEvent", source: { ...pr, repository: { id: REPO_ID } } }];
}

const isStory = (story: Story) => (vars: Record<string, unknown>) =>
  vars.owner === "acme" && vars.name === "widgets" && vars.number === story.story;

/**
 * A fake GitHub answering the settings read at the default branch `main`, every read the start makes of `story`,
 * the card move and the reason post. Calls to any other issue or query throw, naming the call.
 */
export function storyGitHub(story: Story, overrides: { moveCard?: unknown } = {}): FakeGitHub {
  const ofStory = isStory(story);
  const p = story.parent ?? story.story;
  const ledger = story.ledger.readRoutes();
  return fakeGitHub({
    graphql: [
      ...ledger.graphql,
      { when: (query) => query.includes("{ repository(owner: $owner, name: $name) { id } }"), answer: { repository: { id: REPO_ID } } },
      {
        when: (query, vars) => query.includes("parent {") && ofStory(vars),
        answer: {
          repository: {
            id: REPO_ID,
            issue: { parent: story.parent === null ? null : { number: story.parent, repository: { id: REPO_ID, nameWithOwner: NAME_WITH_OWNER } } },
          },
        },
      },
      { when: (query) => query.includes("updateProjectV2ItemFieldValue"), answer: overrides.moveCard ?? { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } } } },
    ],
    graphqlPages: [
      {
        when: (query, vars) => query.includes("statusField") && ofStory(vars),
        answer:
          story.lane === null
            ? []
            : [
                {
                  id: "PVTI_1",
                  project: { id: "PVT_1", url: BOARD, statusField: { id: "PVTSSF_1", options: Lane.schema.options.map((lane) => ({ id: optionId(lane), name: lane })) } },
                  status: { name: story.lane },
                },
              ],
      },
      {
        when: (query, vars) => query.includes("projectItems(") && !query.includes("statusField") && ofStory(vars),
        answer: story.lane === null ? [] : [{ project: { url: BOARD } }],
      },
      { when: (query, vars) => query.includes("comments(") && ofStory(vars), answer: story.comments },
      { when: (query, vars) => query.includes("PROJECT_V2_ITEM_STATUS_CHANGED_EVENT") && ofStory(vars), answer: [] },
      {
        when: (query) => query.includes("CLOSED_EVENT"),
        answer: ({ vars }: { vars: Record<string, unknown> }) => (story.doneIssues.includes(vars.number as number) ? doneTimeline(vars.number as number) : []),
      },
      { when: (query, vars) => query.includes("blockedBy(") && ofStory(vars), answer: related(story.blockers) },
      { when: (query, vars) => query.includes("subIssues(") && ofStory(vars), answer: related(story.subIssues) },
      {
        when: (query, vars) => query.includes("pullRequests(headRefName:") && vars.branch === `${p}-spec`,
        answer: story.specPrs.map((pr) => ({ ...pr, headRefName: `${p}-spec`, headRefOid: "a".repeat(40), isCrossRepository: false })),
      },
      ...ledger.graphqlPages,
    ],
    restPagesMatching: ledger.restPagesMatching,
    rest: {
      "GET /repos/acme/widgets": { default_branch: "main" },
      "GET /repos/acme/widgets/contents/codeworks.toml?ref=main": contentsAnswer(SETTINGS),
      [`POST /repos/acme/widgets/issues/${story.story}/comments`]: {},
    },
    now: GITHUB_NOW,
  });
}

/** Every call that writes, in order: the lane moves and the comments. */
export function writes(calls: readonly FakeCall[]): string[] {
  return calls.flatMap((call) => {
    if (call.kind === "graphql" && call.query.includes("updateProjectV2ItemFieldValue")) return [`lane ${String(call.vars.option).replace(/^option-/, "")}`];
    if (call.kind === "rest" && call.method === "POST") return [`comment ${(call.body as { body: string }).body.split("\n", 1)[0]}`];
    return [];
  });
}

