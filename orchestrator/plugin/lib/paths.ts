import { join } from "node:path";

import type { Repository } from "../core/github.ts";

// One folder per agent machine, not per repository as planner's: one session at a time runs there (SECURITY.md §2).
const STATE_FOLDER = [".local", "state", "codeworks", "orchestrator"];

export function stateFolder(home: string): string {
  return join(home, ...STATE_FOLDER);
}

/** The session's gh config folder, which the managed settings name in GH_CONFIG_DIR. */
export function ghFolder(home: string): string {
  return join(stateFolder(home), "gh");
}

/** Where core keeps each session's issue record, `<session id>.json`. */
export function sessionsFolder(home: string): string {
  return join(stateFolder(home), "sessions");
}

/** The bare copy the Stop hook pushes `repo`'s story branch from (Story 2). */
export function pushCopy(home: string, repo: Repository): string {
  return join(stateFolder(home), "push", repo.owner, `${repo.name}.git`);
}
