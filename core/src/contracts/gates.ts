import { z } from "zod";
import { ClaimVerdict, ShimRuling } from "../values.ts";
import { setExactlyWhen, uniqueBy } from "./refinements.ts";
import { GitSha, Time } from "./scalars.ts";

const Site = z.strictObject({ file: z.string().min(1), line: z.int().min(1), function: z.string().min(1), does: z.string() });
const Sites = z.array(Site).superRefine(uniqueBy((site) => JSON.stringify([site.file, site.function])));

export const Lineage = z.strictObject({
  id: z.string().min(1),
  file: z.string().min(1),
  // Offsets into the anchor's text of `file`.
  places: z.array(z.strictObject({ start: z.int().min(0), end: z.int().min(0), claim: z.string().min(1) })),
  chain: z
    .array(
      z.strictObject({
        ref: z.string().min(1),
        claim: z.string().min(1),
        line: z.int().min(1),
        words: z.string(),
        ruling: ClaimVerdict.schema,
        at: Time,
      }),
    )
    .superRefine(uniqueBy((entry) => JSON.stringify([entry.ref, entry.claim]))),
});
export type Lineage = z.infer<typeof Lineage>;

const Trees = z.array(z.strictObject({ tree: GitSha, at: Time })).superRefine(uniqueBy((entry) => entry.tree, "tree"));

const SiteRuling = z
  .strictObject({ site: z.string().min(1), ruling: ShimRuling.schema, issue: z.int().min(1).nullable() })
  .superRefine((ruling, ctx) => {
    const deferred = ShimRuling.schema.enum.DEFERRED;
    setExactlyWhen(ctx, "issue", ruling.issue, ruling.ruling === deferred, `ruling is ${deferred}`);
  });

export const Bug = z.strictObject({
  id: z.string().min(1),
  members: Trees,
  absorbed: Trees,
  // Lines of the anchor's text of `file`.
  ranges: z.array(z.strictObject({ file: z.string().min(1), old_start: z.int().min(0), old_count: z.int().min(0) })),
  deep: z.strictObject({ same_operation: Sites, callers: Sites }).nullable(),
  rulings: z.array(SiteRuling).superRefine(uniqueBy((ruling) => ruling.site, "site")),
});
export type Bug = z.infer<typeof Bug>;

export const Gates = z.strictObject({
  branch: z.string().min(1),
  // The commit whose file texts `places` and `ranges` index into.
  anchor: GitSha,
  lineages: z.array(Lineage).superRefine(uniqueBy((lineage) => lineage.id, "id")),
  bugs: z.array(Bug).superRefine(uniqueBy((bug) => bug.id, "id")),
});
export type Gates = z.infer<typeof Gates>;
