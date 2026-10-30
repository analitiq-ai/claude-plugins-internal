import { chmodSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify, YAMLParseError } from "yaml";
import { z } from "zod";

import { textIfPresent, writeWhole } from "./files.ts";
import type { MintedToken } from "./tokens.ts";

// Longer than any planner script runs, so a token checked as one starts outlives its GitHub calls.
export const REFRESH_MARGIN_MS = 10 * 60 * 1000;

const HOST = "github.com";
// gh's own file, so gh and `gh auth git-credential` read the token with no wrapper.
const HOSTS_FILE = "hosts.yml";
// gh's hosts.yml holds no expiry and no repository.
const TOKEN_FILE = "codeworks-token.json";

// gh reads a token from any of these before its config folder, so one left set acts instead of the folder's.
export const GH_TOKEN_VARIABLES = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"] as const;

export type StoredToken = { value: string; repo: string; expires_at: string };

/** A gh config folder holding one of the token's two files, or one that does not parse; it is never repaired. */
export class GhFolderRefused extends Error {
  readonly folder: string;

  constructor(folder: string, why: string) {
    super(`${folder}: ${why}`);
    this.name = "GhFolderRefused";
    this.folder = folder;
  }
}

// Not strict: gh rewrites the file the first time it reads it, adding a `users` map beside these keys.
const HostsFile = z.object({ [HOST]: z.object({ oauth_token: z.string().min(1) }) });
const TokenFile = z.strictObject({ repo: z.string(), expires_at: z.iso.datetime() });

export function writeGhToken(folder: string, token: MintedToken, login: string): void {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // mkdir's mode does not reach a folder that already exists.
  chmodSync(folder, 0o700);
  // hosts.yml first: a crash between the two leaves the earlier expiry beside the newer token, which mints early,
  // never late.
  writeWhole(join(folder, HOSTS_FILE), stringify({ [HOST]: { oauth_token: token.value, user: login, git_protocol: "https" } }), renameSync);
  writeWhole(join(folder, TOKEN_FILE), `${JSON.stringify({ repo: token.repo, expires_at: token.expires_at })}\n`, renameSync);
}

export function readGhToken(folder: string): StoredToken | null {
  const hosts = textIfPresent(join(folder, HOSTS_FILE));
  const stored = textIfPresent(join(folder, TOKEN_FILE));
  if (hosts === null && stored === null) return null;
  if (hosts === null) throw new GhFolderRefused(folder, `it holds ${TOKEN_FILE} without ${HOSTS_FILE}`);
  if (stored === null) throw new GhFolderRefused(folder, `it holds ${HOSTS_FILE} without ${TOKEN_FILE}`);
  const { repo, expires_at } = tokenFileOf(folder, stored);
  return { value: hostsFileOf(folder, hosts)[HOST].oauth_token, repo, expires_at };
}

// The file holds the token, so the refusal names the parser's code and line, never its message, which quotes the text.
function hostsFileOf(folder: string, text: string): z.infer<typeof HostsFile> {
  let document: unknown;
  try {
    document = parse(text);
  } catch (error) {
    if (!(error instanceof YAMLParseError)) throw error;
    throw new GhFolderRefused(folder, `${HOSTS_FILE} is not YAML (${error.code} at line ${error.linePos?.[0].line ?? "?"})`);
  }
  const parsed = HostsFile.safeParse(document);
  if (!parsed.success) throw new GhFolderRefused(folder, `${HOSTS_FILE} holds no ${HOST} oauth_token`);
  return parsed.data;
}

function tokenFileOf(folder: string, text: string): z.infer<typeof TokenFile> {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new GhFolderRefused(folder, `${TOKEN_FILE} is not JSON: ${error.message}`);
  }
  const parsed = TokenFile.safeParse(document);
  if (!parsed.success) throw new GhFolderRefused(folder, `${TOKEN_FILE}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function needsMint(stored: StoredToken | null, repo: string, now: Date): boolean {
  if (stored === null || stored.repo !== repo) return true;
  // Written as "not at least the margin" so an expiry or a clock that reads as NaN mints rather than keeps a token.
  return !(Date.parse(stored.expires_at) - now.getTime() >= REFRESH_MARGIN_MS);
}
