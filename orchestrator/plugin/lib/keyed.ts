import { ownerAndName, repositoryPath, restLogin, type GitHubClient } from "../core/github.ts";
import { issueComments } from "../core/state.ts";

// Keys are grammar (plan P7): a key can never close the HTML comment or break its line.
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `prefix`'s key for `cause`, whose words become the key's: one comment per distinct cause. */
export function keyOf(prefix: string, cause: string): string {
  return `${prefix}-${cause.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/**
 * Posts `text` on `issue` under its key line, unless an orchestrator App comment already starts with that line:
 * the comment is the record that the cause was handled (orchestrator ADR-0003 d3–d4).
 */
export async function postKeyed(
  writer: GitHubClient,
  repo: string,
  issue: number,
  key: string,
  text: string,
  orchestratorLogin: string,
): Promise<void> {
  if (!KEY.test(key)) throw new TypeError(`${JSON.stringify(key)} is not a reason key`);
  const line = `<!-- codeworks:orchestrator-reason ${key} -->`;
  const handled = (await issueComments(writer, repo, issue)).some(
    (comment) => restLogin(comment.author) === orchestratorLogin && comment.body.split(/\r?\n/, 1)[0] === line,
  );
  if (handled) return;
  await writer.rest("POST", `${repositoryPath(ownerAndName(repo))}/issues/${issue}/comments`, { body: `${line}\n${text}` });
}
