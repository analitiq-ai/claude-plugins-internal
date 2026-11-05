import { z } from "zod";

import { Taken } from "../values.ts";
import { Repo, Time } from "./scalars.ts";

// The session's issue, in a file because it lasts one session (orchestrator ADR-0003 d1).
export const SessionRecord = z.strictObject({
  v: z.literal(1),
  repo: Repo,
  issue: z.int().min(1),
  taken: Taken.schema,
  at: Time,
});
export type SessionRecord = z.infer<typeof SessionRecord>;
