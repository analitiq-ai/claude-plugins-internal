import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import type { App, mintToken, MintedToken } from "../../plugin/core/tokens.ts";

export const REPO = "acme/widgets";
export const BOARD = "https://github.com/orgs/acme/projects/1";
export const SESSION_LOGIN = "codeworks-session[bot]";
export const ORCHESTRATOR_LOGIN = "codeworks-orchestrator[bot]";
export const APP_ID = 1234567;
export const SESSION_APP_ID = 1234568;
export const STATUS_ISSUE = 1;

const SHARED = `[shared]
board = "${BOARD}"
validators = []
session_app_login = "${SESSION_LOGIN}"
orchestrator_app_login = "${ORCHESTRATOR_LOGIN}"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "codeworks-planner[bot]"
`;

/** codeworks.toml with `orchestrator` as its `[orchestrator]` section's lines. */
export function settingsText(orchestrator: string): string {
  return `${SHARED}\n[orchestrator]\n${orchestrator}`;
}

export const SETTINGS = settingsText(`app_id = ${APP_ID}\nsession_app_id = ${SESSION_APP_ID}\nstatus_issue = ${STATUS_ISSUE}\n`);

/** A new temp folder standing in for `~`, removed after the test. */
export function tempHome(t: TestContext): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "orchestrator-home-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, "-c", "user.name=Dummy", "-c", "user.email=dummy@example.invalid", ...args], {
    env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
}

/** A checkout whose HEAD holds `settings` as codeworks.toml and whose origin names GitHub's acme/widgets. */
export function scratchCheckout(t: TestContext, settings: string | null = SETTINGS): string {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), "orchestrator-checkout-")));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  git(checkout, "init", "-q", "--initial-branch=main");
  git(checkout, "remote", "add", "origin", `https://github.com/${REPO}.git`);
  if (settings !== null) writeFileSync(join(checkout, "codeworks.toml"), settings);
  git(checkout, "add", "-A");
  git(checkout, "commit", "-q", "--allow-empty", "-m", "seed");
  return checkout;
}

/** The contents API's answer for codeworks.toml holding `text`. */
export function contentsAnswer(text: string): unknown {
  return { type: "file", encoding: "base64", content: Buffer.from(text).toString("base64") };
}

export type MintCall = { app: App; appId: number; keyFile: string; plugin: string; repo: string };

export type FakeMintToken = { mintToken: typeof mintToken; calls: MintCall[] };

/**
 * Stands in for core's mintToken: each call answers a new token for its repository expiring an hour after `now()`,
 * or throws `failure` when one is given.
 */
export function fakeMintToken(now: () => Date, failure?: Error): FakeMintToken {
  const calls: MintCall[] = [];
  return {
    calls,
    mintToken: async (app, appId, keyFile, plugin, repo): Promise<MintedToken> => {
      calls.push({ app, appId, keyFile, plugin, repo });
      if (failure !== undefined) throw failure;
      const expires_at = new Date(now().getTime() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
      return { value: randomUUID(), app, repo, expires_at, permissions: {} };
    },
  };
}
