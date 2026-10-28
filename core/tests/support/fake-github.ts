import type { GitHubClient } from "../../src/github.ts";

export type FakeCall =
  | { kind: "rest"; method: string; path: string; body: unknown }
  | { kind: "restPages"; path: string }
  | { kind: "graphql"; query: string; vars: Record<string, unknown> }
  | { kind: "graphqlPages"; query: string; vars: Record<string, unknown>; connectionPath: readonly string[] }
  | { kind: "now" };

/**
 * What a route answers. An `Error` (such as `new GitHubRefused(404, "Not Found")` or `new GitHubUnanswered("…")`)
 * is thrown; a function is called with the call and its result returned, or its throw thrown; anything else is
 * returned as a fresh copy, so code under test cannot change a fixture another call reads.
 */
export type FakeAnswer = unknown;

export type GraphQLRoute = {
  when: (query: string, vars: Record<string, unknown>) => boolean;
  answer: FakeAnswer;
};

export type FakeRoutes = {
  /** Keyed `"<METHOD> <path>"`, the path exactly as the caller passes it, query string included. */
  rest?: Record<string, FakeAnswer>;
  /** Keyed by path; the answer is the whole list, every page read. */
  restPages?: Record<string, FakeAnswer>;
  /** The first route whose `when` holds answers; the answer is `data`. */
  graphql?: GraphQLRoute[];
  /** The first route whose `when` holds answers; the answer is the whole node list, every page read. */
  graphqlPages?: GraphQLRoute[];
  /** GitHub's time, `YYYY-MM-DDTHH:MM:SSZ`. */
  now?: FakeAnswer;
};

export type FakeGitHub = GitHubClient & {
  now(): Promise<string>;
  /** Every call received, in order, answered or not. */
  calls: FakeCall[];
};

/** A client that answers only from `routes`; a call no route answers throws, naming the call. */
export function fakeGitHub(routes: FakeRoutes): FakeGitHub {
  const calls: FakeCall[] = [];

  function answer(call: FakeCall, found: boolean, routed: FakeAnswer): unknown {
    if (!found) throw new Error(`fake GitHub has no answer for ${JSON.stringify(call)}`);
    if (routed instanceof Error) throw routed;
    if (typeof routed === "function") return (routed as (call: FakeCall) => unknown)(call);
    return structuredClone(routed);
  }

  function byKey(table: Record<string, FakeAnswer> | undefined, key: string, call: FakeCall): unknown {
    calls.push(call);
    const found = table !== undefined && Object.hasOwn(table, key);
    return answer(call, found, found ? table[key] : undefined);
  }

  function list(answered: unknown, call: FakeCall): unknown[] {
    if (!Array.isArray(answered)) throw new Error(`fake GitHub's answer for ${JSON.stringify(call)} is not a list`);
    return answered;
  }

  function byQuery(table: GraphQLRoute[] | undefined, query: string, vars: Record<string, unknown>, call: FakeCall): unknown {
    calls.push(call);
    const route = table?.find((candidate) => candidate.when(query, vars));
    return answer(call, route !== undefined, route?.answer);
  }

  return {
    calls,
    async rest(method, path, body) {
      return byKey(routes.rest, `${method} ${path}`, { kind: "rest", method, path, body });
    },
    async restPages(path) {
      const call: FakeCall = { kind: "restPages", path };
      return list(byKey(routes.restPages, path, call), call);
    },
    async graphql(query, vars) {
      return byQuery(routes.graphql, query, vars, { kind: "graphql", query, vars });
    },
    async graphqlPages(query, vars, connectionPath) {
      const call: FakeCall = { kind: "graphqlPages", query, vars, connectionPath };
      return list(byQuery(routes.graphqlPages, query, vars, call), call);
    },
    async now() {
      const call: FakeCall = { kind: "now" };
      calls.push(call);
      const time = answer(call, routes.now !== undefined, routes.now);
      if (typeof time !== "string") throw new Error("fake GitHub's now answer is not a string");
      return time;
    },
  };
}
