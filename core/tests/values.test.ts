import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {test} from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";
import * as z from "zod";
import {
  CheckOutcome,
  ClaimVerdict,
  CoreSource,
  FindingRuling,
  FindingSource,
  HoldKind,
  HoldState,
  Lane,
  ModuleName,
  RootCause,
  RoundResult,
  RoundStage,
  RoundVerdict,
  ShimRuling,
  Taken,
} from "../src/values.ts";
import {moduleFiles, stringLiterals} from "./source-scan.ts";

const core = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(core, "src");

type ValueSet = {schema: {options: readonly string[]}; meaning: Record<string, string>};

const sets: {name: string; set: ValueSet; values: string[]}[] = [
  {name: "round result", set: RoundResult, values: ["CLEAN", "DIRTY", "INCOMPLETE"]},
  {
    name: "round verdict",
    set: RoundVerdict,
    values: ["PATCH", "CLASS_FIX", "REDESIGN", "RESCOPE", "CONVERGED_PUSHBACK", "ESCALATE"],
  },
  {name: "finding ruling", set: FindingRuling, values: ["FIX", "PUSH_BACK", "DEFER", "ESCALATE"]},
  {
    name: "root cause",
    set: RootCause,
    values: ["AT_CAUSE", "AT_SYMPTOM", "SPEC_WRONG", "CANNOT_TELL", "NOT_APPLICABLE"],
  },
  {
    name: "check outcome",
    set: CheckOutcome,
    values: ["PENDING", "PASS", "FAIL", "SILENT", "COULD_NOT_RUN", "WAIVED"],
  },
  {name: "hold kind", set: HoldKind, values: ["rescope", "escalation", "pushback", "claim", "shim", "audit"]},
  {name: "hold state", set: HoldState, values: ["OPEN", "RELEASED"]},
  {name: "round stage", set: RoundStage, values: ["INTERNAL", "AUDIT", "GITHUB"]},
  {name: "lane", set: Lane, values: ["Backlog", "Ready", "In progress", "In review", "Blocked", "Done"]},
  {name: "taken", set: Taken, values: ["claim", "resume"]},
  {name: "claim verdict", set: ClaimVerdict, values: ["CORRECT", "WRONG", "UNSURE"]},
  {name: "shim ruling", set: ShimRuling, values: ["SHARES", "NOT_SHARED", "DEFERRED"]},
];

for (const {name, set, values} of sets) {
  test(`${name} holds exactly ${values.join(", ")}, each with a meaning`, () => {
    assert.deepEqual(new Set(set.schema.options), new Set(values));
    assert.deepEqual(new Set(Object.keys(set.meaning)), new Set(values));
    for (const [value, meaning] of Object.entries(set.meaning)) {
      assert.match(meaning, /\S/, `${value} has no meaning`);
    }
  });
}

test("CoreSource is exactly threads and required-checks", () => {
  assert.deepEqual(new Set(CoreSource.options), new Set(["threads", "required-checks"]));
});

test("ModuleName accepts lower-case names that are no core source", () => {
  for (const name of ["fixture", "a-1"]) assert.equal(ModuleName.safeParse(name).success, true, name);
});

test("ModuleName refuses names outside the grammar and core's own sources", () => {
  for (const name of ["Fixture", "bad_name", "1x", "-x", "", "threads", "required-checks"]) {
    assert.equal(ModuleName.safeParse(name).success, false, JSON.stringify(name));
  }
});

test("FindingSource accepts core's sources and a module name", () => {
  for (const source of ["threads", "required-checks", "fixture"]) {
    assert.equal(FindingSource.safeParse(source).success, true, source);
  }
  assert.equal(FindingSource.safeParse("Fixture").success, false);
});

function enumValues(exported: unknown): string[] {
  if (exported instanceof z.ZodEnum) return exported.options.map(String);
  if (typeof exported === "object" && exported !== null && "schema" in exported) {
    return enumValues(exported.schema);
  }
  return [];
}

// Each value → the files, relative to core/, that export an enum holding it. Found by importing every module, so
// an enum a later module exports is covered without a change here.
async function enumDefinitions(): Promise<Map<string, Set<string>>> {
  const definitions = new Map<string, Set<string>>();
  for (const file of moduleFiles(src)) {
    const exports: Record<string, unknown> = await import(pathToFileURL(file).href);
    for (const value of Object.values(exports).flatMap(enumValues)) {
      definitions.set(value, (definitions.get(value) ?? new Set()).add(relative(core, file)));
    }
  }
  return definitions;
}

function valueStringHits(files: {path: string; text: string}[], definitions: Map<string, Set<string>>): string[] {
  return files.flatMap(({path, text}) =>
    stringLiterals(text, path).flatMap(({value, line}) => {
      const definers = definitions.get(value);
      if (definers === undefined || definers.has(path)) return [];
      return [`${path}:${line} quotes "${value}", a value of an enum defined in ${[...definers].join(", ")}`];
    }),
  );
}

test("the value-string scan names the file and line of a value quoted outside its enum", async () => {
  const inMemory = {path: "src/in-memory.ts", text: "export const result = 'CLEAN';\n"};
  assert.deepEqual(valueStringHits([inMemory], await enumDefinitions()), [
    'src/in-memory.ts:1 quotes "CLEAN", a value of an enum defined in src/values.ts',
  ]);
});

test("the value-string scan reads string literals, not comments or regular expressions", async () => {
  const text = [
    "// it's 'CLEAN' in a comment",
    "/* 'DIRTY' */ const url = \"https://example.test//x\"; const r = 'PASS';",
    "const re = /\"FAIL\"/u;",
    "const half = total / 2; const s = 'DEFER'; const q = total / 4;",
    "const t = `WAIVED`;",
    "const u = `${'OPEN'} at ${{at: 1}.at}`;",
  ].join("\n");
  const hits = valueStringHits([{path: "src/in-memory.ts", text}], await enumDefinitions());
  assert.deepEqual(
    hits.map((hit) => hit.split(",")[0]),
    [
      'src/in-memory.ts:2 quotes "PASS"',
      'src/in-memory.ts:4 quotes "DEFER"',
      'src/in-memory.ts:5 quotes "WAIVED"',
      'src/in-memory.ts:6 quotes "OPEN"',
    ],
  );
});

test("no file in core/src quotes an enum value outside the file that defines it", async () => {
  const files = moduleFiles(src).map((file) => ({path: relative(core, file), text: readFileSync(file, "utf8")}));
  assert.deepEqual(valueStringHits(files, await enumDefinitions()), []);
});
