import { z } from "zod";

import { GitSha, Repo, Time } from "./scalars.ts";

const Pass = z.strictObject({ sha: GitSha, range_from: GitSha, at: Time });

const BranchPasses = z
  .strictObject({ issue: z.int().min(1), head: Pass, passes: z.array(Pass).min(1) })
  .superRefine(({ head, passes }, ctx) => {
    const shas = passes.map(({ sha }) => sha);
    if (new Set(shas).size !== shas.length) ctx.addIssue({ code: "custom", path: ["passes"], message: "a sha appears more than once" });
    if (!shas.includes(head.sha)) ctx.addIssue({ code: "custom", path: ["head", "sha"], message: "head's sha is in no pass" });
  });

export const CommitPasses = z.strictObject({
  v: z.literal(1),
  repository: Repo,
  off: z.boolean(),
  branches: z.record(z.string().min(1), BranchPasses),
});
export type CommitPasses = z.infer<typeof CommitPasses>;
