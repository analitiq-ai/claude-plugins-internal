import { z } from "zod";

import { SETTINGS_FILE, SettingsError, type Settings } from "../core/settings.ts";

const Mode = z.enum(["enforce", "log"]);
const Count = z.int().min(1);

export const ReviewerSettings = z
  .strictObject({
    app_id: Count,
    mode: Mode,
    claim_checks: Mode,
    shim_checks: Mode,
    decision_checks: Mode,
    claim_warn_over: Count,
    max_review_files: Count,
    escalate_to: z.string().min(1),
    max_rounds: Count,
    max_audits: Count,
    k_topic: Count,
    claim_hold_at: Count,
    shim_deep_at: Count,
    shim_hold_at: Count,
    state_write_attempts: Count,
    char_diff_budget: Count,
  })
  .refine((settings) => settings.shim_deep_at < settings.shim_hold_at, {
    path: ["shim_deep_at"],
    message: "must be below shim_hold_at, or the deep check is never due",
  });
export type ReviewerSettings = z.infer<typeof ReviewerSettings>;

export const REVIEWER_SECTION = `${SETTINGS_FILE} [reviewer]`;

/** `[reviewer]` of `settings`, read from whichever tree the caller trusts. */
export function reviewerSettings(settings: Settings): ReviewerSettings {
  const parsed = ReviewerSettings.safeParse(settings.section("reviewer"));
  if (!parsed.success) throw new SettingsError(REVIEWER_SECTION, z.prettifyError(parsed.error), { cause: parsed.error });
  return parsed.data;
}
