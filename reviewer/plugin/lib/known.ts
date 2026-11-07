/** The value at `key`, which the caller holds is there: a missing one is a defect of the caller, not an input to tolerate. */
export function known<V>(lookup: ReadonlyMap<string, V> | Readonly<Record<string, V>>, key: string): V {
  const found = lookup instanceof Map ? lookup.has(key) : Object.hasOwn(lookup, key);
  if (!found) throw new TypeError(`no entry for ${JSON.stringify(key)}`);
  return lookup instanceof Map ? (lookup.get(key) as V) : (lookup as Readonly<Record<string, V>>)[key];
}
