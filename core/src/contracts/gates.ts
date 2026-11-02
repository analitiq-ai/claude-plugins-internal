import { z } from "zod";
import { ClaimRuling, SiteRuling } from "../values.ts";
import { GitSha, Time } from "./scalars.ts";

function uniqueBy<Item>(field: string, idOf: (item: Item) => string) {
  return (items: Item[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const id = idOf(item);
      if (seen.has(id)) ctx.addIssue({ code: "custom", path: [i, field], message: `${field} ${id} is already in the list` });
      seen.add(id);
    });
  };
}

const Site = z.strictObject({ file: z.string().min(1), line: z.int().min(1), function: z.string().min(1), does: z.string() });

export const Lineage = z.strictObject({
  id: z.string().min(1),
  file: z.string().min(1),
  // Offsets into the anchor's text of `file`.
  places: z.array(z.strictObject({ start: z.int().min(0), end: z.int().min(0), claim: z.string().min(1) })),
  chain: z.array(
    z.strictObject({
      ref: z.string().min(1),
      claim: z.string().min(1),
      line: z.int().min(1),
      words: z.string(),
      ruling: ClaimRuling.schema,
      at: Time,
    }),
  ),
});
export type Lineage = z.infer<typeof Lineage>;

const Tree = z.strictObject({ tree: GitSha, at: Time });

export const Bug = z.strictObject({
  id: z.string().min(1),
  members: z.array(Tree),
  absorbed: z.array(Tree),
  // Lines of the anchor's text of `file`.
  ranges: z.array(z.strictObject({ file: z.string().min(1), old_start: z.int().min(0), old_count: z.int().min(0) })),
  deep: z.strictObject({ same_operation: z.array(Site), callers: z.array(Site) }).nullable(),
  rulings: z
    .array(z.strictObject({ site: z.string().min(1), ruling: SiteRuling.schema, issue: z.int().min(1).nullable() }))
    .superRefine(uniqueBy("site", (ruling) => ruling.site)),
});
export type Bug = z.infer<typeof Bug>;

export const Gates = z.strictObject({
  branch: z.string().min(1),
  // The commit whose file texts `places` and `ranges` index into.
  anchor: GitSha,
  lineages: z.array(Lineage).superRefine(uniqueBy("id", (lineage) => lineage.id)),
  bugs: z.array(Bug).superRefine(uniqueBy("id", (bug) => bug.id)),
});
export type Gates = z.infer<typeof Gates>;
