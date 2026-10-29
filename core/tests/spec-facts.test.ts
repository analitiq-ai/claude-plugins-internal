import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import {
  FrontMatterRefused,
  readSpecFacts,
  RootCauseObserved,
  SpecKind,
  writeSpecFacts,
} from "../src/contracts/spec-facts.ts";

function specMd(frontMatter: string, body = "# Feature Specification: dummy\n"): string {
  return `---\n${frontMatter}---\n${body}`;
}

function facts(kind: string, observed: string): string {
  return `codeworks:\n  v: 1\n  kind: ${kind}\n  root_cause:\n    observed: ${observed}\n`;
}

// A named class, so a caller can catch a refusal and nothing else.
function refusedWith(reason: RegExp): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof FrontMatterRefused, String(error));
    assert.match(error.message, /spec\.md/);
    assert.match(error.message, reason);
    return true;
  };
}

// The spelling is planner ADR-0008 d1's; these literals pin it.
test("SpecKind and RootCauseObserved are spelt as planner ADR-0008 d1 fixes them", () => {
  assert.deepEqual(SpecKind.options, ["feature", "defect", "no_spec"]);
  assert.deepEqual(RootCauseObserved.options, ["anchored", "hypothesis", "none"]);
});

for (const kind of ["feature", "defect", "no_spec"]) {
  for (const observed of ["anchored", "hypothesis", "none"]) {
    test(`accepts kind ${kind} with observed ${observed}`, () => {
      assert.deepEqual(readSpecFacts(specMd(facts(kind, observed))), {
        v: 1,
        kind,
        root_cause: { observed },
      });
    });
  }
}

test("reads only up to the first closing --- line, so a rule in the body is not front matter", () => {
  const text = specMd(facts("feature", "none"), "# Title\n\n---\n\nkind: defect\n");
  assert.deepEqual(readSpecFacts(text), { v: 1, kind: "feature", root_cause: { observed: "none" } });
});

test("no front matter fails naming the file", () => {
  assert.throws(() => readSpecFacts("# Feature Specification: dummy\n\nbody\n"), refusedWith(/no front matter/));
});

test("front matter that does not start on the first line is no front matter", () => {
  const text = `# Title\n---\n${facts("feature", "none")}---\n`;
  assert.throws(() => readSpecFacts(text), refusedWith(/no front matter/));
});

test("an opening --- with no closing line is no front matter", () => {
  assert.throws(() => readSpecFacts(`---\n${facts("feature", "none")}`), refusedWith(/no front matter/));
});

test("front matter without a codeworks key fails naming the file", () => {
  assert.throws(() => readSpecFacts(specMd("title: dummy\n")), refusedWith(/no codeworks key/));
});

test("empty front matter has no codeworks key", () => {
  assert.throws(() => readSpecFacts(specMd("")), refusedWith(/no codeworks key/));
});

test("unparsable front matter fails naming the file and the YAML error", () => {
  assert.throws(() => readSpecFacts(specMd("codeworks: [\n")), refusedWith(/unparsable/));
});

test("an unknown key in codeworks fails naming the key", () => {
  const text = specMd(`${facts("feature", "none")}  extra: 1\n`);
  assert.throws(() => readSpecFacts(text), refusedWith(/Unrecognized key: "extra"/));
});

test("an unknown key in root_cause fails naming the key", () => {
  const text = specMd("codeworks:\n  v: 1\n  kind: feature\n  root_cause:\n    observed: none\n    extra: 1\n");
  assert.throws(() => readSpecFacts(text), refusedWith(/Unrecognized key: "extra"[\s\S]*root_cause/));
});

test("a kind outside SpecKind fails naming the field", () => {
  assert.throws(() => readSpecFacts(specMd(facts("bug", "none"))), refusedWith(/Invalid option[\s\S]*at kind/));
});

test("an observed outside RootCauseObserved fails naming the field", () => {
  assert.throws(
    () => readSpecFacts(specMd(facts("feature", "maybe"))),
    refusedWith(/Invalid option[\s\S]*at root_cause\.observed/),
  );
});

test("a version other than 1 fails naming the field", () => {
  const text = specMd("codeworks:\n  v: 2\n  kind: feature\n  root_cause:\n    observed: none\n");
  assert.throws(() => readSpecFacts(text), refusedWith(/at v/));
});

const FEATURE = { v: 1, kind: "feature", root_cause: { observed: "none" } } as const;
const DEFECT = { v: 1, kind: "defect", root_cause: { observed: "anchored" } } as const;
const BODY = "# Feature Specification: dummy\n\n---\n\nbody\n";

// The YAML between the opening and closing lines, read as the reader reads it.
function frontMatterOf(text: string): Record<string, unknown> {
  const lines = text.split("\n");
  assert.equal(lines[0], "---");
  return parse(lines.slice(1, lines.indexOf("---", 1)).join("\n"));
}

test("writeSpecFacts prepends one block to text with no front matter, leaving the text after it as it was", () => {
  assert.equal(
    writeSpecFacts(BODY, FEATURE),
    `---\ncodeworks:\n  v: 1\n  kind: feature\n  root_cause:\n    observed: none\n---\n${BODY}`,
  );
});

test("writeSpecFacts sets codeworks in front matter holding other keys, and keeps them and the body", () => {
  const written = writeSpecFacts(specMd("# kept comment\ntitle: dummy\nauthors:\n  - a\n", BODY), DEFECT);
  assert.deepEqual(frontMatterOf(written), { title: "dummy", authors: ["a"], codeworks: DEFECT });
  assert.match(written, /^# kept comment$/m);
  assert.ok(written.endsWith(`---\n${BODY}`), written);
});

test("writeSpecFacts replaces a codeworks block already there, leaving exactly one", () => {
  const written = writeSpecFacts(specMd(`title: dummy\n${facts("defect", "hypothesis")}`, BODY), DEFECT);
  assert.equal(written.match(/^codeworks:/gm)?.length, 1, written);
  assert.deepEqual(frontMatterOf(written), { title: "dummy", codeworks: DEFECT });
  assert.equal(writeSpecFacts(written, DEFECT), written);
});

test("writeSpecFacts fills empty front matter rather than prepending a second block", () => {
  const written = writeSpecFacts(specMd("", BODY), FEATURE);
  assert.equal(written.match(/^---$/gm)?.length, 3, written);
  assert.deepEqual(readSpecFacts(written), FEATURE);
});

for (const kind of SpecKind.options) {
  for (const observed of RootCauseObserved.options) {
    test(`readSpecFacts reads back what writeSpecFacts wrote for kind ${kind} with observed ${observed}`, () => {
      const written = { v: 1, kind, root_cause: { observed } } as const;
      for (const text of [BODY, specMd("title: dummy\n", BODY), specMd(facts("feature", "none"), BODY)]) {
        assert.deepEqual(readSpecFacts(writeSpecFacts(text, written)), written);
      }
    });
  }
}

test("writeSpecFacts refuses facts SpecFacts refuses, before it reads the text", () => {
  for (const refused of [
    { ...FEATURE, v: 2 },
    { ...FEATURE, kind: "bug" },
    { ...FEATURE, root_cause: { observed: "maybe" } },
    { ...FEATURE, extra: 1 },
  ]) {
    assert.throws(() => writeSpecFacts(specMd("codeworks: [\n"), refused as never), refusedWith(/facts to write/));
  }
});

test("writeSpecFacts refuses front matter it cannot set a key in, naming why", () => {
  assert.throws(() => writeSpecFacts(specMd("codeworks: [\n"), FEATURE), refusedWith(/unparsable/));
  assert.throws(() => writeSpecFacts(specMd("- a\n"), FEATURE), refusedWith(/not a mapping/));
});
