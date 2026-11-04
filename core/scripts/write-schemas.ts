import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { Finding } from "../src/contracts/finding.ts";
import { sortedJsonText } from "../src/contracts/json-text.ts";
import { LedgerEvent } from "../src/contracts/ledger.ts";
import { PremisePick, REPORTS_WRONG_BEHAVIOUR, ROOT_CAUSE } from "../src/contracts/premise.ts";
import { Snapshot } from "../src/contracts/snapshot.ts";
import { SpecFacts } from "../src/contracts/spec-facts.ts";

export const schemasDir = new URL("../schemas/", import.meta.url);
// Under src/, unlike schemas/: only src/ reaches a plugin that carries core.
export const generatedDir = new URL("../src/generated/", import.meta.url);

// The drift test regenerates from this same list, so a schema added here is checked without touching the test.
export const schemaFiles: ReadonlyArray<{ schema: z.ZodType; file: string }> = [
  { schema: SpecFacts, file: "spec-facts.schema.json" },
  { schema: Snapshot, file: "snapshot.schema.json" },
  { schema: Finding, file: "finding.schema.json" },
  { schema: LedgerEvent, file: "ledger-event.schema.json" },
];

export function jsonSchemaText(schema: z.ZodType): string {
  return sortedJsonText(z.toJSONSchema(schema));
}

// Planner's Python reads the premise vocabulary from here; data-model.md "Premise vocabulary" names the keys.
function premiseJsonText(): string {
  return sortedJsonText({
    picks: PremisePick.schema.options,
    reports_wrong_behaviour: REPORTS_WRONG_BEHAVIOUR,
    root_cause: ROOT_CAUSE,
  });
}

// The drift test regenerates from this list too.
export const generatedFiles: ReadonlyArray<{ file: string; text: () => string }> = [
  { file: "premise.json", text: premiseJsonText },
];

if (import.meta.main) {
  await mkdir(schemasDir, { recursive: true });
  for (const { schema, file } of schemaFiles) {
    await writeFile(new URL(file, schemasDir), jsonSchemaText(schema));
  }
  await mkdir(generatedDir, { recursive: true });
  for (const { file, text } of generatedFiles) {
    await writeFile(new URL(file, generatedDir), text());
  }
}
