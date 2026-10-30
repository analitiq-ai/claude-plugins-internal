import { needsMint } from "../core/gh-config.ts";
import type { GitHubClient } from "../core/github.ts";
import type { mintToken, MintedToken } from "../core/tokens.ts";

export type AppTokenDeps = {
  now: () => Date;
  mintToken: typeof mintToken;
  connect: (token: string) => GitHubClient;
};

type Held = { token: MintedToken; client: GitHubClient };

/**
 * A client acting as the orchestrator App on `repo`. Its token lives in this closure only, never on disk where the
 * model's commands could read it (FR-016a), and is minted again before a call once under core's margin is left, so
 * a long hook run never calls with an expired one.
 */
export function orchestratorClient(repo: string, appId: number, deps: AppTokenDeps): GitHubClient {
  let held: Promise<Held> | null = null;

  async function mint(): Promise<Held> {
    const token = await deps.mintToken("orchestrator", appId, "orchestrator-app.pem", "orchestrator", repo);
    return { token, client: deps.connect(token.value) };
  }

  async function current(): Promise<GitHubClient> {
    const holding = held;
    if (holding !== null) {
      const { token, client } = await holding;
      if (!needsMint(token, repo, deps.now())) return client;
      // Calls made together share one mint: a call that finds the stale token already replaced takes the new one.
      if (held !== holding) return current();
    }
    const minting = mint();
    held = minting;
    return (await minting).client;
  }

  return {
    rest: async (method, path, body) => (await current()).rest(method, path, body),
    restPages: async (path) => (await current()).restPages(path),
    graphql: async (query, vars) => (await current()).graphql(query, vars),
    graphqlPages: async (query, vars, connectionPath) => (await current()).graphqlPages(query, vars, connectionPath),
    now: async () => (await current()).now(),
  };
}
