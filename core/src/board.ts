import { z } from "zod";

import { answerOf, assertIssueNumber, ownerAndName, type GitHubClient } from "./github.ts";
import { Lane } from "./values.ts";

/** A card on the board whose Status is no lane: the board is not the one every component reads lanes from. */
export class LaneRefused extends Error {
  constructor(board: string, issue: string, status: string | null) {
    super(`${issue}'s card on ${board} has the status ${JSON.stringify(status)}, which is no lane: ${Lane.schema.options.join(", ")}`);
    this.name = "LaneRefused";
  }
}

const LANE_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      projectItems(first: 100, after: $cursor) {
        nodes {
          project { url }
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

// `project` is null for a project the reader cannot see, which is then not the board. A Status value of another
// field type answers as an empty object, which no lane names.
const LaneItem = z.object({
  project: z.object({ url: z.string() }).nullable(),
  status: z.object({ name: z.string().optional() }).nullable(),
});

/** The lane of `issue`'s card on `board`, or null when the issue has no card there. */
export async function laneOf(reader: GitHubClient, repo: string, issue: number, board: string): Promise<Lane | null> {
  assertIssueNumber(issue);
  const nodes = await reader.graphqlPages(LANE_QUERY, { ...ownerAndName(repo), number: issue }, ["repository", "issue", "projectItems"]);
  const card = answerOf(z.array(LaneItem), nodes, `the project items of ${repo}#${issue}`).find((item) => item.project?.url === board);
  if (card === undefined) return null;
  const status = card.status?.name ?? null;
  const lane = Lane.schema.safeParse(status);
  if (!lane.success) throw new LaneRefused(board, `${repo}#${issue}`, status);
  return lane.data;
}
