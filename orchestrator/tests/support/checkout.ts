import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

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
