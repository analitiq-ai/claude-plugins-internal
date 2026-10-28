import { z } from "zod";

// GitHub ends a request itself after 10 s; the margin lets its own answer arrive before ours gives up.
const REQUEST_TIMEOUT_MS = 15_000;

/** No answer is not an empty or a failed answer: no caller reads it as either. */
export class GitHubUnanswered extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = "GitHubUnanswered";
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

export type GitHubClient = {
  rest(method: string, path: string, body?: unknown): Promise<unknown>;
  restPages(path: string): Promise<unknown[]>;
  graphql(query: string, vars: Record<string, unknown>): Promise<unknown>;
  /** `query` declares `$cursor: String`; the nodes of the connection at `connectionPath` under `data`, every page. */
  graphqlPages(query: string, vars: Record<string, unknown>, connectionPath: readonly string[]): Promise<unknown[]>;
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
    return { status: answer.status, headers: answer.headers, body: JSON.parse(answer.text) };
  }

  async function graphql(query: string, vars: Record<string, unknown>): Promise<unknown> {
    const { status, body } = await request("POST", `${api}/graphql`, { query, variables: vars });
    const answer = GraphQLAnswer.parse(body);
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
        if (!Array.isArray(page.body)) throw new Error(`GET ${path}: a page is not a list, so it has no pages to read`);
        items.push(...page.body);
        url = nextPage(page.headers.get("link"));
        if (url !== null && new URL(url).origin !== apiOrigin) {
          throw new Error(`GET ${path}: the next page is on another host (${url}); the token goes only to ${apiOrigin}`);
        }
      }
      return items;
    },

    graphql,

    async graphqlPages(query, vars, connectionPath) {
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
          throw new Error(`POST /graphql: ${connectionPath.join(".")} is not a connection: ${z.prettifyError(connection.error)}`);
        }
        nodes.push(...connection.data.nodes);
        cursor = connection.data.pageInfo.hasNextPage ? connection.data.pageInfo.endCursor : null;
      } while (cursor !== null);
      return nodes;
    },
  };
}

function failure(what: string, answer: Exchange): GitHubUnanswered | GitHubRefused {
  const { status, headers } = answer;
  const rateLimited = status === 429 || (status === 403 && (headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after")));
  const message = `${what}: ${status} ${messageOf(answer.text)}`;
  if (status >= 400 && status < 500 && !rateLimited) return new GitHubRefused(status, message);
  return new GitHubUnanswered(message);
}

function messageOf(text: string): string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON, such as a proxy's error page: reported as it came.
    return text;
  }
  const parsed = GitHubMessage.safeParse(body);
  return parsed.success ? parsed.data.message : text;
}

function nextPage(link: string | null): string | null {
  for (const [, url, rel] of (link ?? "").matchAll(/<([^>]*)>\s*;\s*rel="([^"]*)"/g)) {
    if (rel.split(/\s+/).includes("next")) return url;
  }
  return null;
}
