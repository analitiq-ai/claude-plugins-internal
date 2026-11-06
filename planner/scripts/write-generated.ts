import { mkdir, readFile, writeFile } from "node:fs/promises";

import { ADR_RULINGS_FILE, ASKED_FILE, STOP_FILE, stepDoneFile } from "../plugin/core/contracts/decision-check.ts";
import { sortedJsonText } from "../plugin/core/contracts/json-text.ts";
import { ADR_STOPS } from "../plugin/lib/adr-check.ts";

const plugin = new URL("../plugin/", import.meta.url);

// The drift test regenerates from this list. adr-check.json holds the run files and the stop table the Python
// driver reads, which reads values from generated files until it moves to TypeScript (root ADR-0010). Spec Kit
// refuses a workflow package that holds a symlink, so the prompts' answer schemas are copies of core's.
export const generatedFiles: ReadonlyArray<{ file: URL; text: () => Promise<string> }> = [
  {
    file: new URL("generated/adr-check.json", plugin),
    text: async () =>
      sortedJsonText({
        files: { asked: ASKED_FILE, rulings: ADR_RULINGS_FILE, stop: STOP_FILE, tasksDue: stepDoneFile("tasks-due") },
        stops: ADR_STOPS,
      }),
  },
  ...["adr-verdict.schema.json", "touched-paths.schema.json"].map((name) => ({
    file: new URL(`speckit/workflows/issue-spec/${name}`, plugin),
    text: () => readFile(new URL(`core/generated/${name}`, plugin), "utf8"),
  })),
];

if (import.meta.main) {
  for (const { file, text } of generatedFiles) {
    await mkdir(new URL(".", file), { recursive: true });
    await writeFile(file, await text());
  }
}
