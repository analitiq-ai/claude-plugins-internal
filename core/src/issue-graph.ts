import { z } from "zod";

import { answerOf, assertIssueNumber, ownerAndName, type GitHubClient } from "./github.ts";
import { DerivationError, repositoryId } from "./identity.ts";

type Relation = "blockedBy" | "subIssues";

// GitHub lets either relation name an issue in another repository, whose number would name a different issue here.
function relationQuery(relation: Relation): string {
  return `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ${relation}(first: 100, after: $cursor) {
        nodes { number repository { id nameWithOwner } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;
}

const RelatedIssue = z.object({
  number: z.number().int().positive(),
  repository: z.object({ id: z.string(), nameWithOwner: z.string() }),
});

async function related(reader: GitHubClient, repo: string, issue: number, relation: Relation, what: string): Promise<number[]> {
  assertIssueNumber(issue);
  const ownId = await repositoryId(reader, repo);
  const nodes = await reader.graphqlPages(relationQuery(relation), { ...ownerAndName(repo), number: issue }, ["repository", "issue", relation]);
  const issues = answerOf(z.array(RelatedIssue), nodes, `${what} of ${repo}#${issue}`);
  const foreign = issues.filter((one) => one.repository.id !== ownId);
  if (foreign.length > 0) {
    const named = foreign.map((one) => `${one.repository.nameWithOwner}#${one.number}`).join(", ");
    throw new DerivationError(`${what} of ${repo}#${issue}`, `in another repository: ${named}`);
  }
  return issues.map((one) => one.number);
}

export function blockedBy(reader: GitHubClient, repo: string, issue: number): Promise<number[]> {
  return related(reader, repo, issue, "blockedBy", "the blockers");
}

export function subIssues(reader: GitHubClient, repo: string, issue: number): Promise<number[]> {
  return related(reader, repo, issue, "subIssues", "the sub-issues");
}
