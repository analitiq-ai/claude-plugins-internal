import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { Snapshot } from "../src/contracts/snapshot.ts";
import { SpecFacts } from "../src/contracts/spec-facts.ts";

export const schemasDir = new URL("../schemas/", import.meta.url);

// The drift test regenerates from this same list, so a schema added here is checked without touching the test.
export const schemaFiles: ReadonlyArray<{ schema: z.ZodType; file: string }> = [
  { schema: SpecFacts, file: "spec-facts.schema.json" },
  { schema: Snapshot, file: "snapshot.schema.json" },
];

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, withSortedKeys((value as Record<string, unknown>)[key])]),
  );
}

export function jsonSchemaText(schema: z.ZodType): string {
  return `${JSON.stringify(withSortedKeys(z.toJSONSchema(schema)), null, 2)}\n`;
}

if (import.meta.main) {
  await mkdir(schemasDir, { recursive: true });
  for (const { schema, file } of schemaFiles) {
    await writeFile(new URL(file, schemasDir), jsonSchemaText(schema));
  }
}
