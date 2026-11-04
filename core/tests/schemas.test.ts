import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generatedDir, generatedFiles, jsonSchemaText, schemaFiles, schemasDir } from "../scripts/write-schemas.ts";

async function committedText(file: string, dir: URL = schemasDir): Promise<string | null> {
  try {
    return await readFile(new URL(file, dir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

for (const { schema, file } of schemaFiles) {
  test(`schemas/${file} is what its schema generates`, async () => {
    const committed = await committedText(file);
    if (committed === null) assert.fail(`schemas/${file} is missing; run node scripts/write-schemas.ts`);
    assert.equal(
      committed,
      jsonSchemaText(schema),
      `schemas/${file} differs from its schema; run node scripts/write-schemas.ts`,
    );
  });
}

for (const { file, text } of generatedFiles) {
  test(`src/generated/${file} is what write-schemas.ts generates`, async () => {
    const committed = await committedText(file, generatedDir);
    if (committed === null) assert.fail(`src/generated/${file} is missing; run node scripts/write-schemas.ts`);
    assert.equal(committed, text(), `src/generated/${file} differs from its source; run node scripts/write-schemas.ts`);
  });
}

test("the schema files are spec facts, the snapshot, a finding and a ledger event", () => {
  assert.deepEqual(
    schemaFiles.map(({ file }) => file),
    ["spec-facts.schema.json", "snapshot.schema.json", "finding.schema.json", "ledger-event.schema.json"],
  );
});

test("the generated files include premise.json", () => {
  assert.deepEqual(
    generatedFiles.map(({ file }) => file),
    ["premise.json"],
  );
});
