import type { z } from "zod";

export function setExactlyWhen(ctx: z.RefinementCtx, field: string, value: unknown, condition: boolean, when: string): void {
  if ((value !== null) !== condition) {
    ctx.addIssue({ code: "custom", path: [field], message: `${field} is set exactly when ${when}` });
  }
}

// `field` names the one field a key is, so the issue lands on it; a key built from several lands on the item.
export function uniqueBy<Item>(keyOf: (item: Item) => string, field?: string) {
  return (items: Item[], ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const key = keyOf(item);
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: field === undefined ? [i] : [i, field], message: `${key} is already in the list` });
      seen.add(key);
    });
  };
}
