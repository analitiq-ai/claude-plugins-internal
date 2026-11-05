import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";
import {
  gitHub,
  GitHubRefused,
  GitHubUnanswered,
  httpsUrl,
  RemoteRefused,
  repositoryOfRemote,
  type GitHubClient,
} from "../src/github.ts";

const TOKEN = "dummy-token-0000";

type Seen = { method: string; url: string; authorization: string | undefined; body: string };
type Answer = (seen: Seen, res: ServerResponse, origin: string) => void;

async function serve(t: TestContext, answer: Answer): Promise<{ api: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const one = { method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization, body };
      seen.push(one);
      answer(one, res, `http://${req.headers.host}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { api: `http://127.0.0.1:${port}`, seen };
}

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function variablesOf(seen: Seen): Record<string, unknown> {
  return (JSON.parse(seen.body) as { variables: Record<string, unknown> }).variables;
}

const CONNECTION_PATH = ["repository", "issue", "comments"];

function connectionPage(nodes: unknown[], endCursor: string | null, hasNextPage: boolean): unknown {
  return { data: { repository: { issue: { comments: { nodes, pageInfo: { hasNextPage, endCursor } } } } } };
}

const QUERY = "query($cursor: String) { viewer { login } }";

// Every request shape the client has, so each answer class is seen through all four.
const CALLS: Array<[string, (client: GitHubClient) => Promise<unknown>]> = [
  ["rest", (client) => client.rest("GET", "/repos/o/r")],
  ["restPages", (client) => client.restPages("/repos/o/r/issues")],
  ["graphql", (client) => client.graphql(QUERY, {})],
  ["graphqlPages", (client) => client.graphqlPages(QUERY, {}, CONNECTION_PATH)],
  ["now", (client) => client.now()],
];

test("no token, no client", () => {
  assert.throws(() => gitHub(""), /token/);
  assert.throws(() => gitHub(undefined as unknown as string), /token/);
});

test("rest sends the token and a JSON body, and returns the parsed answer", async (t) => {
  const { api, seen } = await serve(t, (_seen, res) => reply(res, 201, { id: 7 }));
  const answer = await gitHub(TOKEN, api).rest("POST", "/repos/o/r/issues/1/comments", { body: "hi" });
  assert.deepEqual(answer, { id: 7 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.url, "/repos/o/r/issues/1/comments");
  assert.equal(seen[0]!.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(seen[0]!.body), { body: "hi" });
});

test("restPages follows Link rel=next to the last page", async (t) => {
  const pages: Record<string, unknown[]> = { "1": [1, 2], "2": [3, 4], "3": [5] };
  const { api, seen } = await serve(t, (one, res, origin) => {
    const page = new URL(one.url, origin).searchParams.get("page") ?? "1";
    const next = Number(page) + 1;
    const link =
      next <= 3
        ? `<${origin}/repos/o/r/issues?labels=a,b&page=${next}>; rel="next", <${origin}/repos/o/r/issues?labels=a,b&page=3>; rel="last"`
        : `<${origin}/repos/o/r/issues?labels=a,b&page=1>; rel="first"`;
    reply(res, 200, pages[page], { link });
  });
  const items = await gitHub(TOKEN, api).restPages("/repos/o/r/issues?labels=a,b");
  assert.deepEqual(items, [1, 2, 3, 4, 5]);
  assert.deepEqual(
    seen.map((one) => one.url),
    ["/repos/o/r/issues?labels=a,b", "/repos/o/r/issues?labels=a,b&page=2", "/repos/o/r/issues?labels=a,b&page=3"],
  );
  assert.ok(seen.every((one) => one.authorization === `Bearer ${TOKEN}`));
});

test("restPages never sends the token to a next page on another host", async (t) => {
  const other = await serve(t, (_seen, res) => reply(res, 200, []));
  const { api } = await serve(t, (_seen, res) => reply(res, 200, [1], { link: `<${other.api}/steal?page=2>; rel="next"` }));
  await assert.rejects(gitHub(TOKEN, api).restPages("/repos/o/r/issues"), /another host/);
  assert.equal(other.seen.length, 0);
});

test("restPages refuses a page that is not a list", async (t) => {
  const { api } = await serve(t, (_seen, res) => reply(res, 200, { total_count: 0, check_runs: [] }));
  await assert.rejects(gitHub(TOKEN, api).restPages("/repos/o/r/commits/abc/check-runs"), /not a list/);
});

test("graphql posts the query and variables and returns data", async (t) => {
  const { api, seen } = await serve(t, (_seen, res) => reply(res, 200, { data: { viewer: { login: "someone" } } }));
  const data = await gitHub(TOKEN, api).graphql(QUERY, { n: 1 });
  assert.deepEqual(data, { viewer: { login: "someone" } });
  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.url, "/graphql");
  assert.equal(seen[0]!.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(seen[0]!.body), { query: QUERY, variables: { n: 1 } });
});

test("graphql returns data when errors is empty", async (t) => {
  const { api } = await serve(t, (_seen, res) => reply(res, 200, { data: { viewer: { login: "x" } }, errors: [] }));
  assert.deepEqual(await gitHub(TOKEN, api).graphql(QUERY, {}), { viewer: { login: "x" } });
});

test("graphqlPages follows the cursor to the last page, keeping the caller's variables", async (t) => {
  const pages: Record<string, unknown> = {
    null: connectionPage([{ id: "a" }, { id: "b" }], "c1", true),
    c1: connectionPage([{ id: "c" }], "c2", true),
    c2: connectionPage([{ id: "d" }], "c3", false),
  };
  const { api, seen } = await serve(t, (one, res) => reply(res, 200, pages[String(variablesOf(one).cursor)]));
  const nodes = await gitHub(TOKEN, api).graphqlPages(QUERY, { number: 7 }, CONNECTION_PATH);
  assert.deepEqual(nodes, [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
  assert.deepEqual(
    seen.map(variablesOf),
    [
      { number: 7, cursor: null },
      { number: 7, cursor: "c1" },
      { number: 7, cursor: "c2" },
    ],
  );
});

test("graphqlPages refuses an answer with no connection at the path", async (t) => {
  const { api } = await serve(t, (_seen, res) => reply(res, 200, { data: { repository: { issue: null } } }));
  await assert.rejects(
    gitHub(TOKEN, api).graphqlPages(QUERY, {}, CONNECTION_PATH),
    /repository\.issue\.comments/,
  );
});

test("graphqlPages refuses a next page with no cursor rather than stop short", async (t) => {
  const { api } = await serve(t, (_seen, res) => reply(res, 200, connectionPage([{ id: "a" }], null, true)));
  await assert.rejects(gitHub(TOKEN, api).graphqlPages(QUERY, {}, CONNECTION_PATH), /endCursor/);
});

test("graphqlPages never returns part of the list when a later page fails", async (t) => {
  const { api } = await serve(t, (one, res) => {
    if (variablesOf(one).cursor === null) reply(res, 200, connectionPage([{ id: "a" }], "c1", true));
    else reply(res, 502, { message: "Bad Gateway" });
  });
  await assert.rejects(gitHub(TOKEN, api).graphqlPages(QUERY, {}, CONNECTION_PATH), GitHubUnanswered);
});

const RATE_LIMIT = { resources: { core: { limit: 5000, remaining: 4999, reset: 1793228400, used: 1 } } };

test("now returns the Date of GET /rate_limit as YYYY-MM-DDTHH:MM:SSZ in UTC, whatever the machine's zone", async (t) => {
  const zone = process.env.TZ;
  // A zone ahead of UTC that crosses midnight here, so a local-time reading differs in the date as well as the hour.
  process.env.TZ = "Asia/Kathmandu";
  t.after(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });
  const { api, seen } = await serve(t, (_seen, res) =>
    reply(res, 200, RATE_LIMIT, { date: "Wed, 28 Oct 2026 23:05:07 GMT" }),
  );
  assert.equal(await gitHub(TOKEN, api).now(), "2026-10-28T23:05:07Z");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.method, "GET");
  assert.equal(seen[0]!.url, "/rate_limit");
  assert.equal(seen[0]!.authorization, `Bearer ${TOKEN}`);
});

test("now refuses an answer with no Date header", async (t) => {
  const { api } = await serve(t, (_seen, res) => {
    res.sendDate = false;
    reply(res, 200, RATE_LIMIT);
  });
  await assert.rejects(gitHub(TOKEN, api).now(), /Date/);
});

// asctime's form names no zone, so `Date` would read it in the machine's zone: a wrong time, not GitHub's.
for (const date of ["Wed Oct 28 23:05:07 2026", "soon"]) {
  test(`now refuses a Date header that is not an HTTP date in GMT: ${date}`, async (t) => {
    const { api } = await serve(t, (_seen, res) => reply(res, 200, RATE_LIMIT, { date }));
    await assert.rejects(gitHub(TOKEN, api).now(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Date/);
      assert.ok(error.message.includes(date), error.message);
      return true;
    });
  });
}

for (const [name, call] of CALLS) {
  test(`${name}: a request that gets no answer in time throws GitHubUnanswered`, async (t) => {
    const { api } = await serve(t, () => {});
    const started = Date.now();
    await assert.rejects(call(gitHub(TOKEN, api, 100)), (error: unknown) => {
      assert.ok(error instanceof GitHubUnanswered);
      assert.match(error.message, /100 ms/);
      return true;
    });
    assert.ok(Date.now() - started < 5_000);
  });

  test(`${name}: a body that stops streaming throws GitHubUnanswered at the timeout`, async (t) => {
    const { api } = await serve(t, (_seen, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"data": ');
    });
    await assert.rejects(call(gitHub(TOKEN, api, 100)), GitHubUnanswered);
  });

  test(`${name}: a network error throws GitHubUnanswered`, async (t) => {
    const { api } = await serve(t, (_seen, res) => {
      res.socket?.destroy();
    });
    await assert.rejects(call(gitHub(TOKEN, api)), GitHubUnanswered);
  });

  test(`${name}: a connection cut mid-body throws GitHubUnanswered`, async (t) => {
    const { api } = await serve(t, (_seen, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"data": ', () => res.socket?.destroy());
    });
    await assert.rejects(call(gitHub(TOKEN, api)), GitHubUnanswered);
  });

  const unanswered: Array<[string, number, Record<string, string>]> = [
    ["500", 500, {}],
    ["502", 502, {}],
    ["503", 503, {}],
    ["429", 429, {}],
    ["403 with x-ratelimit-remaining 0", 403, { "x-ratelimit-remaining": "0" }],
    ["403 with retry-after", 403, { "retry-after": "60" }],
    ["429 with retry-after", 429, { "retry-after": "60" }],
  ];
  for (const [label, status, headers] of unanswered) {
    test(`${name}: ${label} throws GitHubUnanswered`, async (t) => {
      const { api } = await serve(t, (_seen, res) => reply(res, status, { message: "busy" }, headers));
      await assert.rejects(call(gitHub(TOKEN, api)), (error: unknown) => {
        assert.ok(error instanceof GitHubUnanswered);
        assert.ok(!(error instanceof GitHubRefused));
        return true;
      });
    });
  }

  const refused: Array<[string, number, Record<string, string>, string]> = [
    ["400", 400, {}, "Problems parsing JSON"],
    ["401", 401, {}, "Bad credentials"],
    ["403 with requests left", 403, { "x-ratelimit-remaining": "4999" }, "Resource not accessible by integration"],
    ["404", 404, {}, "Not Found"],
    ["422", 422, {}, "Validation Failed"],
  ];
  for (const [label, status, headers, message] of refused) {
    test(`${name}: ${label} throws GitHubRefused with the status and GitHub's message`, async (t) => {
      const { api } = await serve(t, (_seen, res) => reply(res, status, { message }, headers));
      await assert.rejects(call(gitHub(TOKEN, api)), (error: unknown) => {
        assert.ok(error instanceof GitHubRefused);
        assert.ok(!(error instanceof GitHubUnanswered));
        assert.equal(error.status, status);
        assert.match(error.message, new RegExp(message));
        assert.doesNotMatch(error.message, new RegExp(TOKEN));
        return true;
      });
    });
  }

  const unread: Array<[string, number, string, typeof GitHubUnanswered | typeof GitHubRefused]> = [
    ["a 502 whose body is not JSON", 502, "<html><body>502 Bad Gateway</body></html>", GitHubUnanswered],
    ["a 404 whose body is not JSON", 404, "<html><body>404 Not Found</body></html>", GitHubRefused],
    ["a 422 whose JSON has no message", 422, '{"errors":[{"code":"invalid"}]}', GitHubRefused],
  ];
  for (const [label, status, body, kind] of unread) {
    test(`${name}: ${label} throws ${kind.name} carrying the body as sent`, async (t) => {
      const { api } = await serve(t, (_seen, res) => {
        res.writeHead(status);
        res.end(body);
      });
      await assert.rejects(call(gitHub(TOKEN, api)), (error: unknown) => {
        assert.ok(error instanceof kind);
        assert.ok(error.message.includes(body), error.message);
        return true;
      });
    });
  }
}

const GRAPHQL_CALLS = CALLS.filter(([name]) => name.startsWith("graphql"));

for (const [name, call] of GRAPHQL_CALLS) {
  test(`${name}: a 200 whose errors hold RATE_LIMITED throws GitHubUnanswered, never data`, async (t) => {
    const { api } = await serve(t, (_seen, res) =>
      reply(res, 200, {
        ...(connectionPage([{ id: "a" }], null, false) as object),
        errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded for installation" }],
      }),
    );
    await assert.rejects(call(gitHub(TOKEN, api)), (error: unknown) => {
      assert.ok(error instanceof GitHubUnanswered);
      assert.match(error.message, /rate limit exceeded/);
      return true;
    });
  });

  test(`${name}: a 200 with any other errors throws GitHubRefused, never data`, async (t) => {
    const { api } = await serve(t, (_seen, res) =>
      reply(res, 200, {
        ...(connectionPage([{ id: "a" }], null, false) as object),
        errors: [
          { type: "NOT_FOUND", path: ["repository"], message: "Could not resolve to a Repository with the name 'o/r'." },
          { message: "Field 'x' doesn't exist on type 'Query'" },
        ],
      }),
    );
    await assert.rejects(call(gitHub(TOKEN, api)), (error: unknown) => {
      assert.ok(error instanceof GitHubRefused);
      assert.equal(error.status, 200);
      assert.match(error.message, /Could not resolve to a Repository/);
      assert.match(error.message, /Field 'x' doesn't exist/);
      return true;
    });
  });
}

test("repositoryOfRemote reads owner and name from a github.com remote in https, scp-like and ssh:// form", () => {
  for (const url of [
    "https://github.com/o/n",
    "https://github.com/o/n.git",
    "git@github.com:o/n.git",
    "ssh://git@github.com/o/n.git",
  ]) {
    assert.deepEqual(repositoryOfRemote(url), { owner: "o", name: "n" }, url);
  }
});

test("repositoryOfRemote refuses another host, a path of more or fewer segments and an empty string", () => {
  for (const url of [
    "https://gitlab.com/o/n.git",
    "git@gitlab.com:o/n.git",
    "ssh://git@example.com/o/n.git",
    "https://github.com/o",
    "git@github.com:o.git",
    "https://github.com/o/n/x",
    "ssh://git@github.com/o/n/x.git",
    "https://github.com/o/..",
    "",
  ]) {
    assert.throws(() => repositoryOfRemote(url), RemoteRefused, JSON.stringify(url));
  }
});

// A remote's text is written into the session's environment file, so a shell character must never pass the parse.
test("repositoryOfRemote refuses an owner or name holding a character GitHub does not allow", () => {
  for (const url of ["https://github.com/o/n';x;'", "git@github.com:o$(x)/n.git", "https://github.com/o/n%20x"]) {
    assert.throws(() => repositoryOfRemote(url), RemoteRefused, url);
  }
});

// The hook writes the refusal to stderr, which Claude Code hands to the session.
test("repositoryOfRemote refuses a remote holding a credential, naming its host and path but not the credential", () => {
  const secret = randomUUID();
  for (const url of [`https://x-access-token:${secret}@github.com/o/n.git`, `https://${secret}@github.com/o/n.git`]) {
    assert.throws(
      () => repositoryOfRemote(url),
      (error: unknown) => {
        assert.ok(error instanceof RemoteRefused);
        assert.ok(error.message.includes("github.com/o/n.git"), error.message);
        assert.ok(!inspect(error).includes(secret), `the refusal holds the credential of ${url}`);
        return true;
      },
    );
  }
});

test("httpsUrl gives a repository's https URL on github.com", () => {
  assert.equal(httpsUrl({ owner: "o", name: "n" }), "https://github.com/o/n.git");
});
