import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ADR_INSTALL, ADR_VERSION, AdrAnswerUnread, checkAdrFolder, readAdrAnswer, type AdrAnswer } from "../src/adr.ts";
import type { ResolvedAdrFolder } from "../src/adr-folders.ts";
import { runGit } from "../src/git.ts";
import type { CouldNotRun } from "../src/outcomes.ts";

// Each case named after a test of reviewer/tests/test_adrkit.py or test_decisions.py ports it (R3). Not ported here:
// test_adrkit.py's Corpora and BrokenRecordPlacements, which adr-folders.test.ts ports;
// test_the_corpora_are_checked_at_the_same_time and test_with_no_corpus_adr_is_not_called, as asking every folder at
// once, and none on an empty list, is the caller's (planner's ask, reviewer's decision check); test_decisions.py's
// DecisionCheckSetting, Result, Refusals and Readme, which grade reviewer's round, not adr's answer.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RECORDS = new URL("./fixtures/adr/corpus/", import.meta.url);
// test_decisions.py's CAPTURE_CALL, from this folder, over reviewer's corpus copied to fixtures/adr/corpus.
const CAPTURE_CALL = [
  "check",
  "--dir",
  "fixtures/adr/corpus",
  "--json",
  "--",
  "src/a.py",
  "lib/b.py",
  "dup/c.py",
  "fixtures/adr/corpus/0006-same-id.md",
  "fixtures/adr/corpus/0007-no-frontmatter.md",
];
const CAPTURED: Record<string, unknown> = JSON.parse(readFileSync(new URL("./fixtures/adr/check.json", import.meta.url), "utf8"));
const CAPTURED_FINDINGS = CAPTURED.findings as Record<string, unknown>[];
const CAPPED_RULES = ["marker-scan-capped", "marker-declarations-capped"];
const FAR = 10_000_000; // ms: a deadline no test reaches
const PATHS = ["src/a.py", "lib/b.py"];
const PATH = process.env.PATH ?? "";

const GOVERNING_READ: AdrAnswer["governing"] = [
  { recordId: "0001", title: "Accepted on src" },
  { recordId: "0005", title: "Path and entity" },
];

const BROKEN_READ: AdrAnswer["broken"] = [
  {
    file: "fixtures/adr/corpus/0007-no-frontmatter.md",
    rule: "frontmatter-fence",
    message: "ADR files must start with a leading --- YAML frontmatter fence",
  },
  {
    file: "fixtures/adr/corpus/0006-same-id.md",
    id: "0006",
    rule: "unique-id",
    message: 'ADR id "0006" is used by multiple records: fixtures/adr/corpus/0006-one-id.md, fixtures/adr/corpus/0006-same-id.md',
  },
];

const NOTICES_READ: AdrAnswer["notices"] = [
  {
    id: "0004",
    matcher: 'affects.path "src/**"',
    message:
      'path matcher "src/**" is qualified with repo "acme/other" and cannot apply in a single-repository corpus; it was skipped, and is kept for a federation that includes that repository.',
  },
  { id: "0003", matcher: 'affects.package "core"', message: 'Package matcher "core" requires a changed-dependency snapshot and is inert.' },
  { id: "0005", matcher: 'affects.entity "billing"', message: 'Entity matcher "billing" has no catalog snapshot and is inert.' },
];

const CAPTURED_READ: AdrAnswer = { governing: GOVERNING_READ, broken: BROKEN_READ, notices: NOTICES_READ };

function findingOf(rule: string, id?: string): Record<string, unknown> {
  const found = CAPTURED_FINDINGS.find((finding) => finding.rule === rule && (id === undefined || finding.id === id));
  assert.ok(found, `the captured answer has no ${rule} finding${id === undefined ? "" : ` on ${id}`}`);
  return found;
}

function without(object: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
}

/** The captured answer with `finding` in place of `replaced`, every other finding as adrkit gave it. */
function withFinding(replaced: Record<string, unknown>, finding: Record<string, unknown>): Record<string, unknown> {
  return { ...CAPTURED, findings: CAPTURED_FINDINGS.map((each) => (each === replaced ? finding : each)) };
}

let scratch: string;
let repo: string;
let bin: string;
let noAdr: string;
let calls: string;
let inside: ResolvedAdrFolder;
let outside: ResolvedAdrFolder;

function quoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** An `adr` that is not adrkit, first on PATH: it logs each call as `<cwd>|<args>`, then runs `body`. */
function standIn(body: string): void {
  rmSync(calls, { force: true });
  const adr = join(bin, "adr");
  writeFileSync(adr, `#!/bin/sh\nprintf '%s|%s\\n' "$(pwd -P)" "$*" >> ${quoted(calls)}\n${body}\n`);
  chmodSync(adr, 0o755);
  process.env.PATH = `${bin}${delimiter}${PATH}`;
}

function answering(version: string, check: string): string {
  return `if [ "$1" = --version ]; then echo ${version}; exit 0; fi\n${check}`;
}

function printing(answer: unknown, exit = 0): string {
  return `printf '%s\\n' ${quoted(JSON.stringify(answer))}\nexit ${exit}`;
}

function loggedCalls(): { cwd: string; args: string }[] {
  if (!existsSync(calls)) return [];
  return readFileSync(calls, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => ({ cwd: line.slice(0, line.indexOf("|")), args: line.slice(line.indexOf("|") + 1) }));
}

function askedCheck(): boolean {
  return loggedCalls().some((call) => call.args.startsWith("check "));
}

/** `result` is `folder`'s COULD_NOT_RUN, never an answer: its reason opens with the folder's entry, names neither the
 *  entry nor the path again before the next step, and ends with `next` as the next step, which may name the path. */
function couldNotRunOf(result: unknown, folder: ResolvedAdrFolder, next: string): string {
  assert.deepEqual(Object.keys(result as object).sort(), ["outcome", "reason"], JSON.stringify(result));
  const { outcome, reason } = result as CouldNotRun;
  assert.equal(outcome, "COULD_NOT_RUN");
  const source = `${folder.entry}: `;
  const nextStep = ` Next step: ${next}.`;
  assert.ok(reason.startsWith(source), reason);
  assert.ok(reason.endsWith(nextStep), reason);
  const why = reason.slice(source.length, reason.length - nextStep.length);
  assert.ok(!why.includes(folder.entry) && !why.includes(folder.path), `the folder is named more than once: ${reason}`);
  return reason;
}

before(async () => {
  // `pwd -P` and git answer with real paths, so a temp dir reached through a symlink would never compare equal.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "core-adr-")));
  repo = join(scratch, "demo");
  bin = join(scratch, "bin");
  noAdr = join(scratch, "no-adr");
  calls = join(scratch, "adr-calls.log");
  for (const dir of [join(repo, "docs", "adr"), join(scratch, "org", "docs", "adr"), bin, noAdr]) {
    mkdirSync(dir, { recursive: true });
  }
  // The cases that narrow PATH take adr off it, not git, which checkAdrFolder asks for the checkout's toplevel.
  const git = PATH.split(delimiter).map((dir) => join(dir, "git")).find((path) => existsSync(path));
  if (git === undefined) throw new Error("git is not on PATH");
  for (const dir of [bin, noAdr]) symlinkSync(git, join(dir, "git"));
  // test_adrkit.py's Outcomes.setUp: an accepted record and a draft, both on src/**, committed.
  copyFileSync(new URL("0001-accepted-on-src.md", RECORDS), join(repo, "docs", "adr", "0001-a.md"));
  copyFileSync(new URL("0002-draft-on-src.md", RECORDS), join(repo, "docs", "adr", "0002-b.md"));
  await runGit(repo, ["init", "-q", "-b", "main"]);
  await runGit(repo, ["add", "-A"]);
  await runGit(repo, ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid", "commit", "-q", "-m", "records"]);
  inside = { entry: "docs/adr", path: join(repo, "docs", "adr"), inside: true, readable: true };
  outside = { entry: "../org/docs/adr", path: join(scratch, "org", "docs", "adr"), inside: false, readable: true };
});

afterEach(() => {
  process.env.PATH = PATH;
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("the adrkit version", () => {
  // FR-013: adrkit.py's VERSION and INSTALL, defined once, in core.
  it("is 0.20.0, installed by one npm command", () => {
    assert.equal(ADR_VERSION, "0.20.0");
    assert.equal(ADR_INSTALL, "npm install -g @adrkit/cli@0.20.0");
  });

  // test_decisions.py Capture.test_the_captured_answer_is_what_adrkit_answers_today
  it("answers today what the captured answer holds", () => {
    const done = spawnSync("adr", CAPTURE_CALL, { cwd: HERE, encoding: "utf8" });
    assert.equal(done.error, undefined, `adr could not run; install it: ${ADR_INSTALL}`);
    assert.deepEqual([done.status, JSON.parse(done.stdout)], [1, CAPTURED]);
  });
});

describe("readAdrAnswer", () => {
  // test_decisions.py Judge.test_accepted_records_govern_and_neither_a_draft_nor_a_broken_record_does
  it("reads the accepted records that govern, by id and title, leaving out a draft and every record broken names", () => {
    const read = readAdrAnswer(CAPTURED);
    assert.ok("governing" in read, JSON.stringify(read));
    assert.deepEqual(read.governing, GOVERNING_READ);
  });

  // test_decisions.py Judge.test_a_matcher_adrkit_cannot_evaluate_in_one_repo_is_a_notice_naming_record_corpus_and_matcher
  it("reads a matcher adrkit cannot evaluate in one repo as a notice naming the record and the matcher", () => {
    const read = readAdrAnswer(CAPTURED);
    assert.ok("notices" in read, JSON.stringify(read));
    assert.deepEqual(read.notices, NOTICES_READ);
    assert.ok(read.notices[0].message.includes('repo "acme/other"'));
  });

  // test_decisions.py Judge.test_a_changed_record_adrkit_fails_on_is_broken_named_by_its_file_and_its_id_when_adrkit_gives_one
  it("reads each error of a failed answer as a broken record: its file, its id when adrkit gives one, rule and message", () => {
    const read = readAdrAnswer(CAPTURED);
    assert.ok("broken" in read, JSON.stringify(read));
    assert.deepEqual(read.broken, BROKEN_READ);
    assert.equal(Object.hasOwn(read.broken[0], "id"), false);
    assert.ok(read.broken[1].message.includes("multiple records"));
  });

  // decisions.py judge reads errors only when `ok` is false: with `ok`, an error is about a record the change never
  // touched, so no record is broken and each still governs.
  it("reads no broken record from an answer that passed, though it holds error findings", () => {
    assert.deepEqual(readAdrAnswer({ ...CAPTURED, ok: true }), {
      governing: [...GOVERNING_READ, { recordId: "0006", title: "Same id" }, { recordId: "0006", title: "Same id" }],
      broken: [],
      notices: NOTICES_READ,
    });
  });

  // test_decisions.py Judge.test_every_other_finding_is_ignored
  it("ignores every other finding", () => {
    const quiet = {
      ...CAPTURED,
      ok: true,
      findings: [
        { rule: "corpus-file-skipped", severity: "warn", message: "skipped notes.md", path: "notes.md" },
        { rule: "affects-bad-pattern", severity: "warn", message: "bad", id: "0001" },
      ],
    };
    assert.deepEqual(readAdrAnswer(quiet), {
      governing: [
        { recordId: "0001", title: "Accepted on src" },
        { recordId: "0005", title: "Path and entity" },
        { recordId: "0006", title: "Same id" },
        { recordId: "0006", title: "Same id" },
      ],
      broken: [],
      notices: [],
    });
  });

  // test_decisions.py Judge.test_a_capped_marker_scan_means_the_corpus_was_not_checked
  for (const rule of CAPPED_RULES) {
    it(`reads a ${rule} finding as a capped scan, and nothing else`, () => {
      const capped = { ...CAPTURED, findings: [...CAPTURED_FINDINGS, { rule, severity: "warn", message: "the cap was reached" }] };
      assert.deepEqual(readAdrAnswer(capped), { capped: [{ rule, message: "the cap was reached" }] });
    });
  }

  // adrkit.py parse and _finding: each ValueError, which test_adrkit.py reaches through a stand-in in
  // test_an_answer_in_a_shape_the_plugin_does_not_read_could_not_run_with_the_install_step.
  const sameId = findingOf("unique-id");
  const repoQualified = findingOf("affects-repo-not-applicable");
  const unresolvablePackage = findingOf("affects-unresolvable", "0003");
  const unresolvableEntity = findingOf("affects-unresolvable", "0005");
  const unread: { what: string; raw: unknown; names: RegExp }[] = [
    { what: "is not an object", raw: null, names: /expected object, received null/ },
    { what: "has no boolean ok", raw: { ...CAPTURED, ok: "false" }, names: /\bok\b/ },
    { what: "has no governing", raw: without(CAPTURED, "governing"), names: /governing/ },
    { what: "has a governing record with no title", raw: { ...CAPTURED, governing: [{ recordId: "0001" }] }, names: /governing|title/ },
    { what: "has a governing record whose recordId is not text", raw: { ...CAPTURED, governing: [{ recordId: 1, title: "t" }] }, names: /governing|recordId/ },
    { what: "has findings that are not a list", raw: { ...CAPTURED, findings: {} }, names: /findings/ },
    ...["rule", "severity", "message"].map((key) => ({
      what: `has a finding with no ${key}`,
      raw: withFinding(sameId, without(sameId, key)),
      names: new RegExp(`\\b${key}\\b`),
    })),
    ...["id", "path", "field", "pattern"].map((key) => ({
      what: `has a finding whose ${key} is not text`,
      raw: withFinding(repoQualified, { ...repoQualified, [key]: 3 }),
      names: new RegExp(`affects-repo-not-applicable|\\b${key}\\b`),
    })),
    ...([
      [unresolvablePackage, "id"],
      [repoQualified, "field"],
      [unresolvableEntity, "pattern"],
    ] as const).map(([notice, key]) => ({
      what: `has an ${String(notice.rule)} notice with no ${key}`,
      raw: withFinding(notice, without(notice, key)),
      names: new RegExp(`${String(notice.rule)}|\\b${key}\\b`),
    })),
    { what: "has an error that names no file", raw: withFinding(sameId, without(sameId, "path")), names: /unique-id|\bpath\b|\bfile\b/ },
    {
      what: "failed with no error finding",
      raw: { ...CAPTURED, findings: CAPTURED_FINDINGS.filter((finding) => finding.severity !== "error") },
      names: /\berror\b/,
    },
  ];
  for (const { what, raw, names } of unread) {
    it(`throws AdrAnswerUnread, naming what is not as adrkit gives it, for an answer that ${what}`, () => {
      assert.throws(
        () => readAdrAnswer(raw),
        (error) => {
          assert.ok(error instanceof AdrAnswerUnread, `expected AdrAnswerUnread, got ${String(error)}`);
          assert.match(error.message, names);
          return true;
        },
      );
    });
  }
});

describe("checkAdrFolder", () => {
  // test_adrkit.py Outcomes.test_each_corpus_answers_with_the_records_that_govern
  it("answers, from the real adr, with the records that govern, a draft not among them", async () => {
    assert.deepEqual(await checkAdrFolder(repo, inside, ["src/a.py"], FAR), {
      governing: [{ recordId: "0001", title: "Accepted on src" }],
      broken: [],
      notices: [],
    });
  });

  it("asks adr --version, then adr check from cwd with an in-repo folder relative to it, and reads exit 1 with a JSON answer", async () => {
    // Named by its absolute path, so `--dir` can only be the folder's path relative to cwd, not the entry.
    const namedAbsolute = { ...inside, entry: inside.path };
    standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
    assert.deepEqual(await checkAdrFolder(repo, namedAbsolute, PATHS, FAR), CAPTURED_READ);
    assert.deepEqual(loggedCalls(), [
      { cwd: repo, args: "--version" },
      { cwd: repo, args: "check --dir docs/adr --json -- src/a.py lib/b.py" },
    ]);
  });

  // adrkit.py check's `cwd = os.path.realpath(root)`: adr runs in the real folder, so `--dir` is relative to it.
  it("runs adr from the real folder of a cwd given through a symlink, with an in-repo folder relative to that", async () => {
    const link = join(scratch, "deeper", "still", "repo-link");
    mkdirSync(join(scratch, "deeper", "still"), { recursive: true });
    symlinkSync(repo, link);
    standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
    assert.deepEqual(await checkAdrFolder(link, inside, PATHS, FAR), CAPTURED_READ);
    assert.deepEqual(loggedCalls(), [
      { cwd: repo, args: "--version" },
      { cwd: repo, args: "check --dir docs/adr --json -- src/a.py lib/b.py" },
    ]);
  });

  // A cwd that does not exist is the caller's fault, not the folder's, so it is never read as adr missing.
  it("throws, adr not called, for a cwd that does not exist", async () => {
    standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
    await assert.rejects(checkAdrFolder(join(scratch, "nowhere"), inside, PATHS, FAR), { code: "ENOENT" });
    assert.deepEqual(loggedCalls(), []);
  });

  // As contract.ts status refuses a timeout that is no time: the caller's fault, never the folder's could not run.
  for (const deadlineMs of [0, -1000, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`throws TypeError, adr not called, for a deadline of ${deadlineMs} ms`, async () => {
      standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
      await assert.rejects(checkAdrFolder(repo, inside, PATHS, deadlineMs), TypeError);
      assert.deepEqual(loggedCalls(), []);
    });
  }

  // adr check of no path answers ok with no record governing, a pass that checked nothing (spec.md Edge Cases).
  it("throws TypeError, adr not called, for no path", async () => {
    standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
    await assert.rejects(checkAdrFolder(repo, inside, [], FAR), TypeError);
    assert.deepEqual(loggedCalls(), []);
  });

  // The folder lies outside the subfolder as `inside: false` says, so only checkAdrFolder's toplevel guard refuses this.
  it("throws TypeError, adr not called, for a cwd below the checkout's toplevel", async () => {
    const below = join(repo, "src");
    mkdirSync(below, { recursive: true });
    standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
    await assert.rejects(checkAdrFolder(below, outside, PATHS, FAR), TypeError);
    assert.deepEqual(loggedCalls(), []);
  });

  // Each a form isPlainPath refuses; why is at checkAdrFolder's path guard.
  for (const path of ["./docs/adr/0001-a.md", "src/../docs/adr/0001-a.md", "docs//adr/0001-a.md", "docs/adr/", "/abs/docs/adr/0001-a.md", ""]) {
    it(`throws TypeError, adr not called, for the path ${JSON.stringify(path)}`, async () => {
      standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
      await assert.rejects(checkAdrFolder(repo, inside, ["src/a.py", path], FAR), TypeError);
      assert.deepEqual(loggedCalls(), []);
    });
  }

  // `inside` picks the form of `--dir`, so a folder resolved from another checkout would be passed in the wrong one.
  for (const { what, wrong } of [
    { what: "an in-repo folder marked outside", wrong: () => ({ ...inside, inside: false }) },
    { what: "a folder beside the repo marked inside", wrong: () => ({ ...outside, inside: true }) },
  ]) {
    it(`throws TypeError, adr not called, for ${what}`, async () => {
      standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
      await assert.rejects(checkAdrFolder(repo, wrong(), PATHS, FAR), TypeError);
      assert.deepEqual(loggedCalls(), []);
    });
  }

  it("reads an answer over the 1 MiB execFile buffers by default", async () => {
    const governing = [{ recordId: "0001", title: "t".repeat(2_000_000) }];
    standIn(answering(ADR_VERSION, printing({ ok: true, governing, findings: [] })));
    const answer = await checkAdrFolder(repo, inside, PATHS, FAR);
    assert.ok("governing" in answer, JSON.stringify(answer));
    assert.deepEqual(answer, { governing, broken: [], notices: [] });
  });

  it("gives adr check a folder outside the repo as its absolute path", async () => {
    standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
    assert.deepEqual(await checkAdrFolder(repo, outside, PATHS, FAR), CAPTURED_READ);
    assert.deepEqual(loggedCalls(), [
      { cwd: repo, args: "--version" },
      { cwd: repo, args: `check --dir ${outside.path} --json -- src/a.py lib/b.py` },
    ]);
  });

  // test_adrkit.py Corpora.test_an_org_setting_that_is_no_absolute_readable_folder_could_not_run, whose folder is
  // now an entry adrFolders marks unreadable.
  for (const absolute of [false, true]) {
    it(`could not run, adr not called, for a folder that is not readable, named by ${absolute ? "its absolute path" : "a relative entry"}`, async () => {
      const path = join(repo, "docs", "locked");
      const unreadable = { entry: absolute ? path : "docs/locked", path, inside: true, readable: false };
      standIn(answering(ADR_VERSION, printing(CAPTURED, 1)));
      const reason = couldNotRunOf(
        await checkAdrFolder(repo, unreadable, PATHS, FAR),
        unreadable,
        `make ${path} a readable folder, or remove the entry from [shared] adr_folders`,
      );
      assert.ok(!reason.includes("commit"), reason);
      assert.deepEqual(loggedCalls(), []);
    });
  }

  // test_adrkit.py Outcomes.test_without_adr_every_corpus_could_not_run_with_the_install_step
  it("could not run, with the install step, when adr is not on PATH", async () => {
    process.env.PATH = noAdr;
    const reason = couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, FAR), inside, ADR_INSTALL);
    assert.match(reason, /the adr command was not found/);
  });

  // adrkit.py check's OSError branch, which no Python test reaches.
  it("could not run, with the install step, when adr cannot be started", async () => {
    rmSync(calls, { force: true });
    writeFileSync(join(bin, "adr"), "#!/bin/sh\necho never\n", { mode: 0o644 });
    chmodSync(join(bin, "adr"), 0o644);
    process.env.PATH = bin;
    const reason = couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, FAR), inside, ADR_INSTALL);
    assert.match(reason, /could not be started/);
  });

  // test_adrkit.py Outcomes.test_another_adrkit_version_could_not_run_with_the_install_step
  it("could not run, with the install step, when adr --version answers another version", async () => {
    standIn(answering("0.19.0", printing(CAPTURED, 1)));
    const reason = couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, FAR), inside, ADR_INSTALL);
    assert.match(reason, /0\.19\.0/);
    assert.equal(askedCheck(), false);
  });

  // adrkit.py check's `version.returncode != 0`, which no Python test reaches. It prints the right version, so only
  // the exit status refuses it.
  it("could not run, with the install step, when adr --version exits non-zero", async () => {
    standIn(`if [ "$1" = --version ]; then echo ${ADR_VERSION}; exit 2; fi\n${printing(CAPTURED, 1)}`);
    couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, FAR), inside, ADR_INSTALL);
    assert.equal(askedCheck(), false);
  });

  // test_adrkit.py Outcomes.test_an_answer_in_a_shape_the_plugin_does_not_read_could_not_run_with_the_install_step
  for (const [what, check] of [
    ["not json", "echo nope"],
    ["no ok", printing(null)],
    ["no governing", printing({ ok: true, findings: [] })],
    ["a notice with no id", printing({ ok: true, governing: [], findings: [{ rule: "affects-unresolvable", severity: "info", message: "m" }] })],
    ["failed with no error", printing({ ok: false, governing: [], findings: [] }, 1)],
  ]) {
    it(`could not run, with the install step, for an answer in a shape adrkit ${ADR_VERSION} does not give: ${what}`, async () => {
      standIn(answering(ADR_VERSION, check));
      couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, FAR), inside, ADR_INSTALL);
    });
  }

  // test_adrkit.py Outcomes.test_an_answer_that_is_not_json_says_so
  it("says an answer on exit 0 is not JSON", async () => {
    standIn(answering(ADR_VERSION, "echo nope"));
    assert.match(couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, FAR), inside, ADR_INSTALL), /is not valid JSON/);
  });

  // test_adrkit.py Outcomes.test_any_other_adrkit_failure_could_not_run_with_adrkits_error (exits 1 and 2), and
  // T007's exit 3 over a JSON answer and exit 1 over stdout that is not JSON.
  for (const [what, check] of [
    ["exits 1 answering on stderr alone", "echo 'Error: it broke' >&2\nexit 1"],
    ["exits 2", "echo 'Error: it broke' >&2\nexit 2"],
    ["exits 3 over a JSON answer", `printf '%s\\n' ${quoted(JSON.stringify(CAPTURED))}\necho 'Error: it broke' >&2\nexit 3`],
    ["exits 1 with stdout that is not JSON", "echo nope\necho 'Error: it broke' >&2\nexit 1"],
  ]) {
    it(`could not run, with adrkit's error, when adr check ${what}`, async () => {
      standIn(answering(ADR_VERSION, check));
      const reason = couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, FAR), inside, "fix what adr says");
      assert.match(reason, /Error: it broke/);
    });
  }

  // test_decisions.py Judge.test_a_capped_marker_scan_means_the_corpus_was_not_checked
  for (const rule of CAPPED_RULES) {
    it(`could not run, naming the cap, when adr check answers a ${rule} finding`, async () => {
      const capped = { ...CAPTURED, findings: [...CAPTURED_FINDINGS, { rule, severity: "warn", message: "the cap was reached" }] };
      standIn(answering(ADR_VERSION, printing(capped, 1)));
      const reason = couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, FAR), inside, "split the change");
      assert.ok(reason.includes(rule), reason);
      assert.ok(reason.includes("the cap was reached"), reason);
    });
  }

  // test_adrkit.py Outcomes.test_a_capped_marker_scan_could_not_run
  it("could not run, naming the cap, when the real adr caps its marker scan", async () => {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "many.py"), "// @adr 0001\n".repeat(65));
    try {
      const reason = couldNotRunOf(await checkAdrFolder(repo, inside, ["src/many.py"], FAR), inside, "split the change");
      assert.ok(reason.includes("marker-declarations-capped"), reason);
    } finally {
      rmSync(join(repo, "src"), { recursive: true, force: true });
    }
  });

  // test_adrkit.py Outcomes.test_a_call_past_the_deadline_names_each_steps_seconds
  it("could not run past the deadline, naming it and each step's seconds", async () => {
    standIn(answering(ADR_VERSION, "exec sleep 5"));
    const reason = couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, 1000), inside, "rerun the check");
    assert.match(reason, /deadline\D*1(?:\.0+)? s\b/);
    assert.match(reason, /adr --version \d+(?:\.\d+)? s\b/);
    assert.match(reason, /adr check \d+(?:\.\d+)? s\b/);
  });

  it("could not run past the deadline when adr --version is the slow step, adr check never asked", async () => {
    standIn(`if [ "$1" = --version ]; then exec sleep 5; fi\n${printing(CAPTURED, 1)}`);
    const reason = couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, 1000), inside, "rerun the check");
    assert.match(reason, /adr --version \d+(?:\.\d+)? s\b/);
    assert.equal(askedCheck(), false);
  });

  // Each step alone ends within the deadline; together they do not.
  it("could not run past the deadline when the two steps together outlast it", async () => {
    standIn(`if [ "$1" = --version ]; then sleep 0.7; echo ${ADR_VERSION}; exit 0; fi\nsleep 0.7\n${printing(CAPTURED, 1)}`);
    const reason = couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, 1000), inside, "rerun the check");
    assert.match(reason, /adr check \d+(?:\.\d+)? s\b/);
  });

  it("ends at the deadline an adr that ignores SIGTERM", async () => {
    standIn(answering(ADR_VERSION, "trap '' TERM\nexec sleep 10"));
    const started = performance.now();
    couldNotRunOf(await checkAdrFolder(repo, inside, PATHS, 500), inside, "rerun the check");
    assert.ok(performance.now() - started < 5000, `adr outlived its deadline by ${performance.now() - started - 500} ms`);
  });
});
