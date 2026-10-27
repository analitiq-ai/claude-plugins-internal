import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { jsonSchemaText, schemaFiles, schemasDir } from "../scripts/write-schemas.ts";

async function committedText(file: string): Promise<string | null> {
  try {
    return await readFile(new URL(file, schemasDir), "utf8");
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
