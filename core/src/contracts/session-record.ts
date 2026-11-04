import { z } from "zod";

import { ownerAndName } from "../github.ts";
import { Taken } from "../values.ts";
import { Time } from "./scalars.ts";

const Repo = z.string().superRefine((repo, ctx) => {
  try {
    ownerAndName(repo);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
  }
});

// The session's issue, in a file because it lasts one session (orchestrator ADR-0003 d1).
export const SessionRecord = z.strictObject({
  v: z.literal(1),
  repo: Repo,
  issue: z.int().min(1),
  taken: Taken.schema,
  at: Time,
});
export type SessionRecord = z.infer<typeof SessionRecord>;
