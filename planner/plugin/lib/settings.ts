import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import type { Repository } from "../core/github.ts";
import { readSettings, SETTINGS_FILE, SettingsError, type Shared } from "../core/settings.ts";
import { gitTree } from "../core/tree.ts";

export const PlannerSettings = z.strictObject({ app_id: z.number().int().positive() });
export type PlannerSettings = z.infer<typeof PlannerSettings>;

const PLANNER_SECTION = `${SETTINGS_FILE} [planner]`;

/** `codeworks.toml` at the checkout's HEAD: `[shared]` as core validates it, `[planner]` as planner does. */
export async function readPlannerSettings(checkout: string): Promise<{ shared: Shared; planner: PlannerSettings }> {
  const settings = await readSettings(gitTree(checkout, "HEAD"));
  const planner = PlannerSettings.safeParse(settings.section("planner"));
  if (!planner.success) {
    throw new SettingsError(PLANNER_SECTION, z.prettifyError(planner.error), { cause: planner.error });
  }
  return { shared: settings.shared, planner: planner.data };
}

const STATE_FOLDER = [".local", "state", "codeworks", "planner"];

/**
 * Planner's gh config folder for `repo`, the one the hook writes and every script reads. One per repository, so
 * planner sessions in two repositories do not overwrite each other's one-repository token.
 */
export function ghFolder(repo: Repository): string {
  return join(homedir(), ...STATE_FOLDER, repo.owner, repo.name, "gh");
}

/** Present once a session's start has finished; the hook refuses every Bash call of a session without one. */
export function sessionRecord(sessionId: string): string {
  return join(homedir(), ...STATE_FOLDER, "sessions", sessionId);
}
