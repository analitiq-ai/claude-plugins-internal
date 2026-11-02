import { createPrivateKey, type KeyObject, sign } from "node:crypto";
import { z } from "zod";

import { answerOf, assertPositiveInteger, gitHub, GitHubRefused, ownerAndName, type GitHubClient, type Repository } from "./github.ts";
import { type Machine, readKey } from "./keys.ts";

export type Permissions = Readonly<Record<string, "read" | "write">>;

// Each App's permission set, under GitHub's API keys; a test pins them to SECURITY.md §3.
export const APP_PERMISSIONS = {
  session: {
    metadata: "read",
    contents: "read",
    pull_requests: "read",
    issues: "read",
    checks: "read",
    statuses: "read",
    actions: "read",
    organization_projects: "read",
  },
  orchestrator: {
    contents: "write",
    pull_requests: "write",
    issues: "write",
    checks: "write",
    workflows: "write",
    organization_projects: "write",
  },
  reviewer: { issues: "write" },
  planner: { contents: "write", pull_requests: "write", issues: "write", organization_projects: "read" },
} as const satisfies Record<string, Permissions>;

export type App = keyof typeof APP_PERMISSIONS;

// Every App holds metadata read, which GitHub may list in a token's permissions unasked.
const UNASKED = { name: "metadata", level: "read" };

// GitHub refuses an App JWT living over ten minutes; `iat` sits back a minute for a machine clock ahead of GitHub's.
const JWT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 9 * 60;
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** No token was handed out, and no other credential was tried. */
export class MintError extends Error {
  declare readonly cause: string;

  constructor(cause: string) {
    super(`mint failed: ${cause}`, { cause });
    this.name = "MintError";
  }
}

/** Where a mint reaches; each absent, the real one: api.github.com, and the machine this runs on. */
export type MintContext = { api?: string; machine?: Machine };

export type MintedToken = {
  /** Never logged or put in an error. */
  readonly value: string;
  readonly app: App;
  readonly repo: string;
  readonly expires_at: string;
  /** As GitHub's answer grants them. */
  readonly permissions: Readonly<Record<string, string>>;
};

const Installation = z.object({ id: z.number().int().positive() });

const TokenAnswer = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime(),
  permissions: z.record(z.string(), z.string()),
  repositories: z.array(z.object({ full_name: z.string() })),
});

/** A one-hour installation token of `app` for `repo` alone, with exactly that App's permissions. */
export async function mintToken(
  app: App,
  appId: number,
  keyFile: string,
  plugin: string,
  repo: string,
  context: MintContext = {},
): Promise<MintedToken> {
  if (!Object.hasOwn(APP_PERMISSIONS, app)) throw new TypeError(`no permission set for an App named ${JSON.stringify(app)}`);
  assertPositiveInteger(appId, "an App ID");
  const repository = ownerAndName(repo);
  const permissions: Permissions = APP_PERMISSIONS[app];

  const asApp = gitHub(appJwt(privateKeyOf(readKey(keyFile, plugin, context.machine), keyFile), appId), context.api);
  const installation = await installationOf(asApp, app, repository);
  const answer = answerOf(
    TokenAnswer,
    await asApp.rest("POST", `/app/installations/${installation}/access_tokens`, { repositories: [repository.name], permissions }),
    `the ${app} App's token for ${repo}`,
  );
  // GitHub's docs list /rate_limit for an installation token, not for an App JWT (not run).
  const gitHubNow = await gitHub(answer.token, context.api).now();
  const reasons = [
    ...repositoryReasons(answer.repositories, repo),
    ...expiryReasons(answer.expires_at, gitHubNow),
    ...permissionReasons(permissions, answer.permissions),
  ];
  if (reasons.length > 0) throw new MintError(`GitHub's token for the ${app} App on ${repo} is refused: ${reasons.join("; ")}`);
  return { value: answer.token, app, repo, expires_at: answer.expires_at, permissions: answer.permissions };
}

function privateKeyOf(pem: Buffer, keyFile: string): KeyObject {
  try {
    return createPrivateKey(pem);
  } catch (error) {
    // OpenSSL's message names the decoder that failed, never the bytes it was given.
    throw new MintError(`${keyFile} holds no private key: ${(error as Error).message}`);
  }
}

// RS256 is RSASSA-PKCS1-v1_5 over SHA-256, the signature `sign` makes with an RSA key by default.
function appJwt(key: KeyObject, appId: number): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (json: object) => Buffer.from(JSON.stringify(json)).toString("base64url");
  const claims = { iat: now - JWT_BACKDATE_SECONDS, exp: now + JWT_LIFETIME_SECONDS, iss: appId };
  const signed = `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}`;
  return `${signed}.${sign("sha256", Buffer.from(signed), key).toString("base64url")}`;
}

async function installationOf(asApp: GitHubClient, app: App, repository: Repository): Promise<number> {
  const repo = `${repository.owner}/${repository.name}`;
  let answer: unknown;
  try {
    answer = await asApp.rest("GET", `/repos/${[repository.owner, repository.name].map(encodeURIComponent).join("/")}/installation`);
  } catch (error) {
    if (error instanceof GitHubRefused && error.status === 404) throw new MintError(`the ${app} App is not installed on ${repo}`);
    throw error;
  }
  return answerOf(Installation, answer, `the ${app} App's installation on ${repo}`).id;
}

// GitHub's owner and repository names ignore case, and its answer spells them as GitHub stores them.
function repositoryReasons(named: readonly { full_name: string }[], repo: string): string[] {
  const names = named.map((repository) => repository.full_name);
  if (names.length === 1 && names[0].toLowerCase() === repo.toLowerCase()) return [];
  return [`it names ${names.length === 0 ? "no repository" : names.join(", ")}, not ${repo} alone`];
}

// GitHub writes expires_at by its own clock, which the machine's may trail by more than the exchange takes.
// `gitHubNow` is read after the token was issued, so the time between counts toward the hour rather than against it.
function expiryReasons(expiresAt: string, gitHubNow: string): string[] {
  if (Date.parse(expiresAt) - Date.parse(gitHubNow) <= TOKEN_LIFETIME_MS) return [];
  return [`expires_at ${expiresAt} is more than one hour away`];
}

// Exactly the set asked for: a raised level is refused as a lowered one is.
function permissionReasons(asked: Permissions, granted: Readonly<Record<string, string>>): string[] {
  const reasons: string[] = [];
  for (const [name, level] of Object.entries(asked)) {
    if (!Object.hasOwn(granted, name)) reasons.push(`it lacks ${name}: ${level}`);
    else if (granted[name] !== level) reasons.push(`it grants ${name}: ${granted[name]}, not ${level}`);
  }
  for (const [name, level] of Object.entries(granted)) {
    if (Object.hasOwn(asked, name) || (name === UNASKED.name && level === UNASKED.level)) continue;
    reasons.push(`it adds ${name}: ${level}`);
  }
  return reasons;
}
