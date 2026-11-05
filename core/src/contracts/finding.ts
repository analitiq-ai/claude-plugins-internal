import { z } from "zod";
import { FindingSource } from "../values.ts";
import { setExactlyWhen } from "./refinements.ts";

// Only trusted reviewers' comments are carried, so a brief never holds text from anyone else (reviewer ADR-0016 d2).
export const TrustedComment = z.strictObject({ id: z.string(), author: z.string(), body: z.string() });
export type TrustedComment = z.infer<typeof TrustedComment>;

export const Finding = z
  .strictObject({
    source: FindingSource,
    // Stable across heads, so a pushback recorded at one head names the same item at the next.
    key: z.string().min(1),
    // REST form, `<slug>[bot]` for an App, so one login compares equal however GitHub gave it.
    author: z.string(),
    file: z.string().nullable(),
    line: z.int().min(1).nullable(),
    text: z.string(),
    thread_id: z.string().nullable(),
    resolvable: z.boolean(),
    trusted_comments: z.array(TrustedComment),
    // With `thread_id`, it tells a trusted reply since the last ruling from a thread already ruled (reviewer
    // ADR-0016 d3).
    latest_trusted_comment_id: z.string().nullable(),
  })
  .superRefine((finding, ctx) => {
    const thread = finding.thread_id !== null;
    const refuse = (field: string, message: string): void => {
      ctx.addIssue({ code: "custom", path: [field], message });
    };
    if (finding.resolvable !== thread) refuse("resolvable", "resolvable is true exactly when thread_id is set");
    setExactlyWhen(ctx, "latest_trusted_comment_id", finding.latest_trusted_comment_id, thread, "thread_id is set");
    if (!thread && finding.trusted_comments.length > 0) {
      refuse("trusted_comments", "trusted_comments is empty without a thread");
    }
  });
export type Finding = z.infer<typeof Finding>;
