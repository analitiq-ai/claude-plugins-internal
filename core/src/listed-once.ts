import { z } from "zod";

/** An array of `item` that refuses two entries with one key, naming that key. */
export function listedOnce<Item extends z.ZodType>(item: Item, keyOf: (value: z.infer<Item>) => string = (value) => JSON.stringify(value)) {
  return z.array(item).superRefine((items, ctx) => {
    const keys = items.map(keyOf);
    keys.forEach((key, i) => {
      if (keys.indexOf(key) !== i) ctx.addIssue({ code: "custom", message: `${key} is listed more than once`, path: [i] });
    });
  });
}
