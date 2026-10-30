import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";

import type { FakeGitHub } from "../../../core/tests/support/fake-github.ts";
import { writeGhToken } from "../../plugin/core/gh-config.ts";
import type { App } from "../../plugin/core/tokens.ts";
import type { HookDeps } from "../../plugin/lib/hook-io.ts";
import { ghFolder } from "../../plugin/lib/paths.ts";
import { fakeMintToken, REPO, SESSION_LOGIN, tempHome } from "./checkout.ts";

export const NOW = new Date("2026-10-30T12:00:00Z");

/** A recorded hook input from fixtures/hooks/, its fields replaced by `fields`. */
export function hookInput(fixture: string, fields: Record<string, unknown>): string {
  const recorded = JSON.parse(readFileSync(new URL(`../fixtures/hooks/${fixture}`, import.meta.url), "utf8")) as Record<string, unknown>;
  return JSON.stringify({ ...recorded, ...fields });
}

/** A hook's deps over a temp home, NOW, a fake mint failing as `failures` says, and `github` for every token. */
export function hookDeps(t: TestContext, github: FakeGitHub, failures: Partial<Record<App, Error>> = {}) {
  const home = tempHome(t);
  const mint = fakeMintToken(() => NOW, failures);
  let connects = 0;
  const deps: HookDeps = { home, now: () => NOW, mintToken: mint.mintToken, connect: () => ((connects += 1), github) };
  return { home, deps, mint, connects: () => connects };
}

/** Stores a session token for `repo` expiring `minutes` after NOW, and answers its value. */
export function storeSessionToken(home: string, minutes: number, repo = REPO): string {
  const value = crypto.randomUUID();
  const expires_at = new Date(NOW.getTime() + minutes * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  writeGhToken(ghFolder(home), { value, app: "session", repo, expires_at, permissions: {} }, SESSION_LOGIN);
  return value;
}
