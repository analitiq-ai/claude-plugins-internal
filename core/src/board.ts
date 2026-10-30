import { z } from "zod";

import { answerOf, assertIssueNumber, ownerAndName, type GitHubClient } from "./github.ts";
import { Lane } from "./values.ts";

/** The board answers or takes no lane for an issue: it has no card there, or its Status is not the lanes'. */
export class LaneRefused extends Error {
  constructor(why: string) {
    super(why);
    this.name = "LaneRefused";
  }
}

const CARD_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      projectItems(first: 100, after: $cursor) {
        nodes {
          id
          project {
            id
            url
            statusField: field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
          }
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const MOVE_MUTATION = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }
  ) {
    projectV2Item { id }
  }
}`;

// `project` is null for a project the reader cannot see, which is then not the board.
type ProjectItem = { project: { url: string } | null };
type BoardItem<Item extends ProjectItem> = Item & { project: NonNullable<Item["project"]> };

// A Status value of another field type answers as an empty object, which no lane names.
const LaneItem = z.object({
  project: z.object({ url: z.string() }).nullable(),
  status: z.object({ name: z.string().optional() }).nullable(),
});

// A Status field of another type answers as an empty object, which offers no lane.
const MoveItem = z.object({
  id: z.string(),
  project: z
    .object({
      id: z.string(),
      url: z.string(),
      statusField: z.object({ id: z.string(), options: z.array(z.object({ id: z.string(), name: z.string() })) }).partial().nullable(),
    })
    .nullable(),
});

async function cardOn<Item extends ProjectItem>(
  client: GitHubClient,
  repo: string,
  issue: number,
  board: string,
  item: z.ZodType<Item>,
): Promise<BoardItem<Item> | undefined> {
  assertIssueNumber(issue);
  const nodes = await client.graphqlPages(CARD_QUERY, { ...ownerAndName(repo), number: issue }, ["repository", "issue", "projectItems"]);
  return answerOf(z.array(item), nodes, `the project items of ${repo}#${issue}`).find(
    (node): node is BoardItem<Item> => node.project?.url === board,
  );
}

/** The lane of `issue`'s card on `board`, or null when the issue has no card there. */
export async function laneOf(reader: GitHubClient, repo: string, issue: number, board: string): Promise<Lane | null> {
  const card = await cardOn(reader, repo, issue, board, LaneItem);
  if (card === undefined) return null;
  const status = card.status?.name ?? null;
  const lane = Lane.schema.safeParse(status);
  if (!lane.success) {
    const lanes = Lane.schema.options.join(", ");
    throw new LaneRefused(`${repo}#${issue}'s card on ${board} has the status ${JSON.stringify(status)}, which is no lane: ${lanes}`);
  }
  return lane.data;
}

/** Writes `lane` to the Status of `issue`'s card on `board`. `writer` is the orchestrator App's: no other has projects write. */
export async function moveCard(writer: GitHubClient, repo: string, issue: number, board: string, lane: Lane): Promise<void> {
  const card = await cardOn(writer, repo, issue, board, MoveItem);
  if (card === undefined) throw new LaneRefused(`${repo}#${issue} has no card on ${board} to move to ${JSON.stringify(lane)}`);
  const { statusField } = card.project;
  const option = statusField?.options?.find(({ name }) => name === lane);
  if (statusField?.id === undefined || option === undefined) {
    throw new LaneRefused(`${repo}#${issue}'s card on ${board} has no single-select Status field with the option ${JSON.stringify(lane)}`);
  }
  await writer.graphql(MOVE_MUTATION, { project: card.project.id, item: card.id, field: statusField.id, option: option.id });
}
