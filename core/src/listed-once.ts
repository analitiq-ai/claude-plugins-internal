import { z } from "zod";

/** An array of `item` that refuses two entries with one key, naming that key; with no `keyOf`, two equal entries. */
export function listedOnce<Item extends z.ZodType>(item: Item, keyOf?: (value: z.infer<Item>) => string) {
  const keys = keyOf ?? ((value: z.infer<Item>) => JSON.stringify(value));
  const list = z.array(item).superRefine((items, ctx) => {
    const listed = items.map(keys);
    listed.forEach((key, i) => {
      if (listed.indexOf(key) !== i) ctx.addIssue({ code: "custom", message: `${key} is listed more than once`, path: [i] });
    });
  });
  // A generated JSON Schema drops the refinement; it can say equal entries, but not a key.
  return keyOf === undefined ? list.meta({ uniqueItems: true }) : list;
}
