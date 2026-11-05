function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, withSortedKeys((value as Record<string, unknown>)[key])]),
  );
}

/** A JSON value's text, the same whatever order its keys were set in: two-space indent, a trailing newline. */
export function sortedJsonText(value: unknown): string {
  return `${JSON.stringify(withSortedKeys(value), null, 2)}\n`;
}
