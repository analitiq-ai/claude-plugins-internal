import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

import type { FakeCall } from "../../../core/tests/support/fake-github.ts";
import { readGhToken, writeGhToken } from "../../plugin/core/gh-config.ts";
import type { MintedToken } from "../../plugin/core/tokens.ts";
import { ghFolder } from "../../plugin/lib/settings.ts";

export const REPO = { owner: "acme", name: "widgets" } as const;
export const LOGIN = "codeworks-planner[bot]";
export const BOARD = "https://github.com/orgs/acme/projects/1";

const SETTINGS = `[shared]
board = "${BOARD}"
validators = []
session_app_login = "codeworks-session[bot]"
orchestrator_app_login = "codeworks-orchestrator[bot]"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "${LOGIN}"

[planner]
app_id = 424242
`;

const HOME_VARIABLES = ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"] as const;

/** HOME and XDG_* point at a new temp folder for the test; both are put back and the folder removed after it. */
export function tempHome(t: TestContext): string {
  const saved = Object.fromEntries(HOME_VARIABLES.map((name) => [name, process.env[name]]));
  const home = mkdtempSync(join(tmpdir(), "planner-home-"));
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.XDG_STATE_HOME = join(home, ".local", "state");
  process.env.XDG_DATA_HOME = join(home, ".local", "share");
  process.env.XDG_CACHE_HOME = join(home, ".cache");
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

/** git as the fixtures need it: no machine or user config, a dummy committer. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, "-c", "user.name=Dummy", "-c", "user.email=dummy@example.invalid", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
}

export function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

export type Scratch = { root: string; bare: string; checkout: string };

/**
 * A bare repository standing in for GitHub's acme/widgets, its `main` holding codeworks.toml and `files`, and a
 * clone of it whose origin names GitHub, as an admin's checkout does.
 */
export function scratchCheckout(t: TestContext, files: Readonly<Record<string, string>> = {}): Scratch {
  const root = mkdtempSync(join(tmpdir(), "planner-checkout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bare = join(root, "widgets.git");
  const seed = join(root, "seed");
  const checkout = join(root, "checkout");
  git(root, "init", "-q", "--bare", "--initial-branch=main", bare);
  git(root, "init", "-q", "--initial-branch=main", seed);
  writeFiles(seed, { "codeworks.toml": SETTINGS, ...files });
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "seed");
  git(seed, "push", "-q", bare, "main");
  git(root, "clone", "-q", bare, checkout);
  git(checkout, "remote", "set-url", "origin", `https://github.com/${REPO.owner}/${REPO.name}.git`);
  return { root, bare, checkout };
}

/** Commits `files` on top of the bare repository's `from` and pushes the commit to its `branch`, as another writer would. */
export function pushFromElsewhere(scratch: Scratch, from: string, branch: string, files: Readonly<Record<string, string>>): void {
  const other = mkdtempSync(join(scratch.root, "elsewhere-"));
  git(scratch.root, "clone", "-q", "--branch", from, scratch.bare, other);
  writeFiles(other, files);
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "elsewhere");
  git(other, "push", "-q", scratch.bare, `HEAD:refs/heads/${branch}`);
}

// GitHub writes `expires_at` in whole seconds.
function expiringIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Planner's token for acme/widgets in its gh folder, as a script writes it, expiring `minutesLeft` from now. */
export function storeToken(minutesLeft: number): string {
  const value = randomUUID();
  writeGhToken(ghFolder(REPO), { value, app: "planner", repo: `${REPO.owner}/${REPO.name}`, expires_at: expiringIn(minutesLeft), permissions: {} }, LOGIN);
  return value;
}

/** The token planner's gh folder holds for acme/widgets, or null. */
export function storedToken(): string | null {
  return readGhToken(ghFolder(REPO))?.value ?? null;
}

export type FakeMint = {
  mint: (appId: number, repo: string) => Promise<MintedToken>;
  /** One `<app id> <repo>` per call. */
  calls: string[];
};

/** Stands in for core's mintToken: each call answers a new one-hour token for its repository. */
export function fakeMint(): FakeMint {
  const calls: string[] = [];
  return {
    calls,
    mint: async (appId, repo) => {
      calls.push(`${appId} ${repo}`);
      return { value: randomUUID(), app: "planner", repo, expires_at: expiringIn(60), permissions: {} };
    },
  };
}

/** The calls that write: every REST call but a GET, and every GraphQL mutation. */
export function writeCalls(calls: readonly FakeCall[]): FakeCall[] {
  return calls.filter(
    (call) =>
      (call.kind === "rest" && call.method.toUpperCase() !== "GET") ||
      ((call.kind === "graphql" || call.kind === "graphqlPages") && /^\s*mutation\b/.test(call.query)),
  );
}

export type Output = { lines: string[]; write: (line: string) => void };

export function output(): Output {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}
