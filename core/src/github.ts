import { z } from "zod";

import { jsonOf } from "./files.ts";

// GitHub ends a request itself after 10 s; the margin lets its own answer arrive before ours gives up.
const REQUEST_TIMEOUT_MS = 15_000;

/** No answer is not an empty or a failed answer: no caller reads it as either. */
export class GitHubUnanswered extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = "GitHubUnanswered";
  }
}

/**
 * An answer not of the shape asked, or one another read disagrees with, is no answer either: every caller takes it as
 * one and reads none of it.
 */
export class GitHubMisanswered extends GitHubUnanswered {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = "GitHubMisanswered";
  }
}

/** GitHub answered only part of what was asked, the same part on every run, so no retry alone reads the rest. */
export class GitHubPartlyAnswered extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "GitHubPartlyAnswered";
  }
}

export class GitHubRefused extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubRefused";
    this.status = status;
  }
}

export type Repository = { owner: string; name: string };

// A `.` or `..` segment would resolve into another REST endpoint once the repository is put in a URL.
export function ownerAndName(repo: string): Repository {
  const parts = repo.split("/");
  if (parts.length !== 2 || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError(`not an owner/name repository: ${JSON.stringify(repo)}`);
  }
  return { owner: parts[0], name: parts[1] };
}

export function repositoryPath({ owner, name }: Repository): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** A git remote that is not a repository on github.com, so no planner token is minted for it or pushed to it. */
export class RemoteRefused extends Error {
  constructor(url: string, why: string) {
    super(`remote ${JSON.stringify(withoutUserinfo(url))} is not a github.com repository: ${why}`);
    this.name = "RemoteRefused";
  }
}

// A URL's userinfo may hold the admin's token, and planner's scripts write this refusal to stderr, which reaches the
// session. The greedy match ends at the last `@` before the path, so a password holding a stray `@` goes whole.
export function withoutUserinfo(url: string): string {
  return url.replace(/^([^:/?#]+:\/\/)[^/?#]*@/, "$1***@");
}

// GitHub's own characters for an owner and a repository name. The parsed pair names a folder below planner's state
// folder, so nothing wider may pass.
const REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

export function repositoryOfRemote(url: string): Repository {
  const parts = REMOTE.exec(url);
  if (parts === null) {
    throw new RemoteRefused(url, "not https://github.com/<owner>/<name>, git@github.com:<owner>/<name> or ssh://git@github.com/<owner>/<name>");
  }
  try {
    return ownerAndName(`${parts[1]}/${parts[2]}`);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new RemoteRefused(url, error.message);
  }
}

export function httpsUrl(repo: Repository): string {
  const { owner, name } = ownerAndName(`${repo.owner}/${repo.name}`);
  return `https://github.com/${owner}/${name}.git`;
}

export function assertPositiveInteger(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`not ${what}: ${n}`);
}

export function assertIssueNumber(n: number): void {
  assertPositiveInteger(n, "an issue number");
}

export function answerOf<Schema extends z.ZodType>(schema: Schema, answer: unknown, what: string): z.output<Schema> {
  const parsed = schema.safeParse(answer);
  if (!parsed.success) {
    throw new GitHubMisanswered(`GitHub's answer for ${what} is not the shape asked for: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export type GitHubClient = {
  rest(method: string, path: string, body?: unknown): Promise<unknown>;
  restPages(path: string): Promise<unknown[]>;
  graphql(query: string, vars: Record<string, unknown>): Promise<unknown>;
  /** `query` declares `$cursor: String`; the nodes of the connection at `connectionPath` under `data`, every page. */
  graphqlPages(query: string, vars: Record<string, unknown>, connectionPath: readonly string[]): Promise<unknown[]>;
  /** GitHub's clock, not the machine's: what core stamps is compared with GitHub's `createdAt` values. */
  now(): Promise<string>;
};

const GitHubMessage = z.object({ message: z.string() });

const GraphQLAnswer = z.object({
  data: z.unknown(),
  errors: z.array(z.object({ type: z.string().optional(), message: z.string() })).optional(),
});

const Connection = z.object({
  nodes: z.array(z.unknown()),
  pageInfo: z
    .object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
    .refine((page) => !page.hasNextPage || page.endCursor !== null, "hasNextPage is true with no endCursor"),
});

/**
 * Every node of the connection at `connectionPath` under `data`, asked page by page through `graphql`, so each page
 * is its own call; `query` declares `$cursor: String`.
 */
export async function connectionNodes(
  graphql: GitHubClient["graphql"],
  query: string,
  vars: Record<string, unknown>,
  connectionPath: readonly string[],
): Promise<unknown[]> {
  const nodes: unknown[] = [];
  let cursor: string | null = null;
  do {
    const data = await graphql(query, { ...vars, cursor });
    const found = connectionPath.reduce<unknown>(
      (value, key) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined),
      data,
    );
    const connection = Connection.safeParse(found);
    if (!connection.success) {
      throw new GitHubMisanswered(`POST /graphql: ${connectionPath.join(".")} is not a connection: ${z.prettifyError(connection.error)}`);
    }
    nodes.push(...connection.data.nodes);
    cursor = connection.data.pageInfo.hasNextPage ? connection.data.pageInfo.endCursor : null;
  } while (cursor !== null);
  return nodes;
}

type Exchange = { status: number; headers: Headers; text: string };

export function gitHub(token: string, api = "https://api.github.com", timeoutMs = REQUEST_TIMEOUT_MS): GitHubClient {
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("gitHub needs a token: there is no default or ambient credential");
  }
  const apiOrigin = new URL(api).origin;

  async function exchange(what: string, method: string, url: string, body: unknown): Promise<Exchange> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      // Read inside the timeout and the catch: a body that stalls or is cut off is no answer either.
      const text = await response.text();
      return { status: response.status, headers: response.headers, text };
    } catch (error) {
      const why = signal.aborted ? `no answer within ${timeoutMs} ms` : `no answer (${String(error)})`;
      throw new GitHubUnanswered(`${what}: ${why}`, { cause: error });
    }
  }

  async function request(method: string, url: string, body?: unknown): Promise<{ status: number; headers: Headers; body: unknown }> {
    const { pathname, search } = new URL(url);
    const what = `${method} ${pathname}${search}`;
    const answer = await exchange(what, method, url, body);
    if (answer.status < 200 || answer.status > 299) throw failure(what, answer);
    // No call core makes is answered with 204, so a 2xx body that is not JSON is never an empty answer.
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer.text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new GitHubMisanswered(`${what}: the answer is not JSON: ${error.message}`, { cause: error });
    }
    return { status: answer.status, headers: answer.headers, body: parsed };
  }

  async function graphql(query: string, vars: Record<string, unknown>): Promise<unknown> {
    const { status, body } = await request("POST", `${api}/graphql`, { query, variables: vars });
    const answer = answerOf(GraphQLAnswer, body, "POST /graphql");
    const errors = answer.errors ?? [];
    if (errors.length === 0) return answer.data;
    const message = `POST /graphql: ${errors.map((error) => error.message).join("; ")}`;
    // GitHub answers its primary GraphQL rate limit with 200 and this error type, not with a status.
    if (errors.some((error) => error.type === "RATE_LIMITED")) throw new GitHubUnanswered(message);
    throw new GitHubRefused(status, message);
  }

  return {
    async rest(method, path, body) {
      return (await request(method, `${api}${path}`, body)).body;
    },

    async restPages(path) {
      const items: unknown[] = [];
      let url: string | null = `${api}${path}`;
      while (url !== null) {
        const page = await request("GET", url);
        if (!Array.isArray(page.body)) throw new GitHubMisanswered(`GET ${path}: a page is not a list, so it has no pages to read`);
        items.push(...page.body);
        url = nextPage(page.headers.get("link"));
        if (url !== null && new URL(url).origin !== apiOrigin) {
          throw new GitHubPartlyAnswered(`GET ${path}: the next page is on another host (${url}); the token goes only to ${apiOrigin}`);
        }
      }
      return items;
    },

    graphql,

    async graphqlPages(query, vars, connectionPath) {
      return connectionNodes(graphql, query, vars, connectionPath);
    },

    // Any token may read /rate_limit, and the read does not count against the limit.
    async now() {
      const { headers } = await request("GET", `${api}/rate_limit`);
      return gitHubTime(headers.get("date"));
    },
  };
}

// Only IMF-fixdate is taken: it names GMT, while `Date` reads a zoneless form, such as asctime's, in the machine's
// zone, which would stamp a time that is not GitHub's.
function gitHubTime(date: string | null): string {
  if (date === null) throw new GitHubMisanswered("GET /rate_limit: the answer has no Date header");
  const time = Date.parse(date);
  if (Number.isNaN(time) || new Date(time).toUTCString() !== date) {
    throw new GitHubMisanswered(`GET /rate_limit: the Date header ${JSON.stringify(date)} is not an HTTP date in GMT`);
  }
  return `${new Date(time).toISOString().slice(0, 19)}Z`;
}

function failure(what: string, answer: Exchange): GitHubUnanswered | GitHubRefused {
  const { status, headers } = answer;
  const rateLimited = status === 429 || (status === 403 && (headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after")));
  const message = `${what}: ${status} ${messageOf(answer.text)}`;
  if (status >= 400 && status < 500 && !rateLimited) return new GitHubRefused(status, message);
  return new GitHubUnanswered(message);
}

// A body that is not GitHub's message, such as a proxy's error page, is reported as it came.
function messageOf(text: string): string {
  return jsonOf(text, GitHubMessage, () => null)?.message ?? text;
}

function nextPage(link: string | null): string | null {
  for (const [, url, rel] of (link ?? "").matchAll(/<([^>]*)>\s*;\s*rel="([^"]*)"/g)) {
    if (rel.split(/\s+/).includes("next")) return url;
  }
  return null;
}

// GitHub's type for a person; an App acts as a `Bot`, so it is never a writer (P9).
export const USER_TYPE = "User";
const BOT_TYPE = "Bot";

/** A GraphQL author or actor, asked for as `{ __typename login }`. */
export const Actor = z.object({ __typename: z.string(), login: z.string() });
export type Actor = z.infer<typeof Actor>;

/**
 * `actor`'s login in REST form, null for a deleted account. GraphQL names an App as a `Bot` by its bare login,
 * while `[shared]`, a package's `logins` and REST hold `<slug>[bot]`, so every login is compared in that form.
 */
export function restLogin(actor: Actor | null): string | null {
  if (actor === null) return null;
  return actor.__typename === BOT_TYPE ? appRestLogin(actor.login) : actor.login;
}

/** The REST login of the App whose slug, or GraphQL's bare `Bot` login, is `slug`. */
export function appRestLogin(slug: string): string {
  return `${slug}[bot]`;
}

// `role_name`, not the legacy `permission`, which folds maintain into write and names no custom role.
const ADMIN_ROLE = "admin";
const WRITER_ROLES: ReadonlySet<string> = new Set([ADMIN_ROLE, "maintain", "write"]);

/** A writer's role, as a done close and an admin's comment both read it (orchestrator ADR-0010 d2). */
export function isWriterRole(role: string): boolean {
  return WRITER_ROLES.has(role);
}

/** The one role whose deletion on `ledger` clears a tamper's files (FR-022). */
export function isAdminRole(role: string): boolean {
  return role === ADMIN_ROLE;
}

const PermissionAnswer = z.object({ role_name: z.string() });

/** `login`'s role on `repo`; a non-collaborator's is `read` on a public repo and empty on a private one. */
export async function roleOf(reader: GitHubClient, repo: Repository, login: string): Promise<string> {
  const answer = await reader.rest("GET", `${repositoryPath(repo)}/collaborators/${encodeURIComponent(login)}/permission`);
  return answerOf(PermissionAnswer, answer, `${login}'s role on ${repo.owner}/${repo.name}`).role_name;
}
