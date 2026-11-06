import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { generatedFiles } from "../scripts/write-generated.ts";

describe("planner's generated files", () => {
  for (const { file, text } of generatedFiles) {
    it(`${fileURLToPath(file)} is what write-generated.ts writes`, async () => {
      assert.equal(readFileSync(file, "utf8"), await text(), "run node scripts/write-generated.ts");
    });
  }
});
