import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { Lineage } from "../plugin/core/contracts/gates.ts";
import {
  acceptContest,
  cacheable,
  CATEGORIES,
  checkStatus,
  citedHosts,
  citedPaths,
  claimId,
  claimRef,
  type ClaimCheck,
  type Claim,
  contestOutcome,
  enterRuling,
  fetchAllowed,
  type Hunk,
  JUDGED,
  mintLineage,
  notJudged,
  parseClaimRef,
  readerSpan,
  stillCorrect,
  toJudge,
  validateReader,
  validateVerdict,
  type Verdict,
  wrongClaims,
  withRead,
} from "../plugin/lib/rules/claim.ts";

const STAGED: Record<string, string[]> = {
  "README.md": ["# Demo", "", "The validator rejects an empty list,", "and it logs the reason.", "", "Other text."],
  "validator.py": ["def check(items):", "    return True"],
};
const located = (path: string): number | null => STAGED[path]?.length ?? null;
const QUOTE = "The validator rejects an empty list";
const AT = "2026-11-01T10:00:00Z";

function hunk(fields: Partial<Hunk> = {}): Hunk {
  return { id: "h1", file: "README.md", old_start: 3, old_count: 1, new_start: 3, new_count: 2, removed: ["old"], added: ["new"], patch_id: "p1", ...fields };
}

function claim(quote = QUOTE, fields: Partial<Claim> = {}): Claim {
  const file = fields.file ?? "README.md";
  return { id: claimId(file, quote), hunk: "h1", file, line: 3, quote, category: "K1", ...fields };
}

function verdict(kind: Verdict["verdict"] = "WRONG", fields: Partial<Verdict> = {}): Verdict {
  return {
    verdict: kind,
    basis: "b",
    assertions: [{ text: "it rejects an empty list", confirmed: kind === "CORRECT", evidence: "validator.py:2" }],
    ...(kind === "WRONG" ? { failing_case: "check([]) returns True" } : {}),
    ...(kind === "UNSURE" ? { gap: "the caller is in another repo" } : {}),
    ...fields,
  };
}

function check(fields: Partial<ClaimCheck> = {}, claims: Claim[] = [claim()]): ClaimCheck {
  return { hunks: [hunk()], labels: { h1: "PROSE" }, claims: Object.fromEntries(claims.map((c) => [c.id, c])), verdicts: {}, contests: {}, ...fields };
}

function lineage(fields: Partial<Lineage> = {}): Lineage {
  return { id: "a".repeat(16), file: "README.md", places: [{ start: 0, end: 36, claim: claim().id }], chain: [], ...fields };
}

describe("claim ids", () => {
  it("follow the file and the words, a claim's id the first 16 hex of the sha256 of its file, a NUL and its words", () => {
    const same = claimId("README.md", "the validator rejects");
    assert.equal(same, claimId("README.md", "the  validator\n rejects"));
    assert.notEqual(same, claimId("README.md", "the validator accepts"));
    assert.notEqual(same, claimId("docs/x.md", "the validator rejects"));
    assert.equal(claimId("a.md", "café 日"), createHash("sha256").update("a.md\0café 日", "utf8").digest("hex").slice(0, 16));
  });

  it("name a claim claim-<id>, and only that form parses back", () => {
    const id = claimId("README.md", "the validator rejects");
    assert.equal(claimRef(id), `claim-${id}`);
    assert.equal(parseClaimRef(claimRef(id)), id);
    for (const other of [id, `claim-${id}x`, ` claim-${id}`, "claim-", null, 7]) assert.equal(parseClaimRef(other), null, String(other));
  });

  it("the vocabularies: nine categories, of which K1 and K9 are judged", () => {
    assert.deepEqual(CATEGORIES, ["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8", "K9"]);
    assert.deepEqual(JUDGED, ["K1", "K9"]);
  });
});

describe("validateReader", () => {
  const output = (...hunks: { id: string; kind: string; claims: { line: number; quote: string; category: string }[] }[]) => ({ hunks });
  const validate = (hunks: ReturnType<typeof output>["hunks"], batch: Hunk[] = [hunk()]) =>
    validateReader(output(...hunks), batch.map((each) => readerSpan(each, STAGED[each.file])));

  it("passes a quote from the hunk's paragraph", () => {
    const claims = [{ line: 3, quote: "The validator rejects an empty list, and it logs", category: "K1" }];
    assert.deepEqual(validate([{ id: "h1", kind: "PROSE", claims }]), []);
  });

  it("needs every hunk of the batch exactly once", () => {
    const empty = { id: "h1", kind: "PROSE", claims: [] };
    assert.notDeepEqual(validate([empty], [hunk(), hunk({ id: "h2", old_start: 6, new_start: 6, new_count: 1 })]), []);
    assert.notDeepEqual(validate([empty, empty]), []);
    assert.notDeepEqual(validate([{ ...empty, id: "h9" }]), []);
  });

  it("rejects a quote that is not the staged text, naming its file and line", () => {
    const [error] = validate([{ id: "h1", kind: "PROSE", claims: [{ line: 3, quote: "The validator rejects every list", category: "K1" }] }]);
    assert.match(error, /README\.md:3/);
  });

  it("rejects a claim on a line outside the hunk's paragraph", () => {
    assert.notDeepEqual(validate([{ id: "h1", kind: "PROSE", claims: [{ line: 6, quote: "Other text.", category: "K1" }] }]), []);
  });

  it("rejects a claim in a CODE hunk", () => {
    assert.notDeepEqual(validate([{ id: "h1", kind: "CODE", claims: [{ line: 3, quote: QUOTE, category: "K1" }] }]), []);
  });

  it("reads a removal in the paragraph it leaves behind", () => {
    const removal = hunk({ old_start: 4, old_count: 1, new_start: 3, new_count: 0, removed: ["only for admins"], added: [] });
    assert.deepEqual(validate([{ id: "h1", kind: "PROSE", claims: [{ line: 3, quote: QUOTE, category: "K1" }] }], [removal]), []);
  });

  it("takes comment marks and line breaks as no words", () => {
    const lines = ["# the gate refuses", "# every commit", "x = 1"];
    const span = readerSpan(hunk({ file: "a.py", old_start: 1, old_count: 0, new_start: 1, new_count: 3 }), lines);
    const claims = [{ line: 1, quote: "the gate refuses every commit", category: "K1" }];
    assert.deepEqual(validateReader(output({ id: "h1", kind: "MIXED", claims }), [span]), []);
  });
});

describe("validateVerdict", () => {
  const validate = (body: Verdict, contest = false) => validateVerdict(body, located, { contest });

  it("passes a well-formed verdict of each kind", () => {
    for (const kind of ["CORRECT", "WRONG", "UNSURE"] as const) assert.deepEqual(validate(verdict(kind)), [], kind);
  });

  it("refuses CORRECT with an unconfirmed assertion, or one with no path:line", () => {
    assert.notDeepEqual(validate(verdict("CORRECT", { assertions: [{ text: "a", confirmed: false, evidence: "validator.py:1" }] })), []);
    assert.notDeepEqual(validate(verdict("CORRECT", { assertions: [{ text: "a", confirmed: true, evidence: "I read it" }] })), []);
  });

  it("refuses WRONG with no failing case, or with no unconfirmed assertion that cites a line", () => {
    assert.notDeepEqual(validate(verdict("WRONG", { failing_case: "" })), []);
    assert.notDeepEqual(validate(verdict("WRONG", { assertions: [{ text: "a", confirmed: true, evidence: "validator.py:1" }] })), []);
  });

  it("needs a path:line for every settled assertion; UNSURE's open question needs none", () => {
    const reasoned = { text: "so the finding halts", confirmed: false, evidence: "this follows from the first" };
    const broken = { text: "a", confirmed: false, evidence: "validator.py:1" };
    const found = { text: "a", confirmed: true, evidence: "validator.py:1" };
    assert.notDeepEqual(validate(verdict("WRONG", { assertions: [broken, reasoned] })), []);
    assert.notDeepEqual(validate(verdict("UNSURE", { assertions: [{ ...found, evidence: "I read it" }, reasoned] })), []);
    assert.deepEqual(validate(verdict("UNSURE", { assertions: [found, reasoned] })), []);
  });

  it("refuses UNSURE with a blank gap", () => {
    assert.notDeepEqual(validate(verdict("UNSURE", { gap: " " })), []);
  });

  it("refuses a citation of a file or line the checked tree lacks, naming it", () => {
    const [error] = validate(verdict("WRONG", { assertions: [{ text: "a", confirmed: false, evidence: "notes/untracked.py:3" }] }));
    assert.match(error, /notes\/untracked\.py/);
    assert.notDeepEqual(validate(verdict("WRONG", { assertions: [{ text: "a", confirmed: false, evidence: "validator.py:9" }] })), []);
  });

  it("takes a URL as evidence only in a contest", () => {
    const cited = verdict("WRONG", { assertions: [{ text: "a", confirmed: false, evidence: "https://docs.example/x" }] });
    assert.notDeepEqual(validate(cited), []);
    assert.deepEqual(validate(cited, true), []);
  });

  it("cites the paths of the lines a verdict names", () => {
    assert.deepEqual(citedPaths(verdict("CORRECT"), located), new Set(["validator.py"]));
  });
});

describe("a check's progress", () => {
  it("is reading while a hunk has no label, judging while a judged claim has no verdict", () => {
    assert.equal(checkStatus(check({ labels: {} })), "reading");
    assert.equal(checkStatus(check()), "judging");
  });

  it("completes once every judged claim has a verdict, whatever the verdicts cite", () => {
    assert.equal(checkStatus(check({ verdicts: { [claim().id]: verdict("WRONG") } })), "complete");
    const nothing = verdict("UNSURE", { assertions: [{ text: "a", confirmed: false, evidence: "not found" }] });
    assert.equal(checkStatus(check({ verdicts: { [claim().id]: nothing } })), "complete");
  });

  it("judges K1 and K9 and counts the other categories", () => {
    const listed = claim("every rule is listed", { category: "K3" });
    const named = claim("test_an_empty_list_is_rejected", { file: "tests/test_validator.py", category: "K9" });
    assert.equal(checkStatus(check({}, [listed])), "complete");
    const both = check({}, [named, listed]);
    assert.equal(checkStatus(both), "judging");
    assert.deepEqual(toJudge(both), [named]);
    assert.deepEqual(notJudged(both), { K3: 1 });
  });

  it("records a reader's label and claims under the claims' ids", () => {
    const read = withRead(check({ labels: {} }, []), hunk(), "MIXED", [{ line: 3, quote: QUOTE, category: "K1" }]);
    assert.deepEqual(read.labels, { h1: "MIXED" });
    assert.deepEqual(read.claims, { [claim().id]: claim() });
  });

  it("lists the claims ruled WRONG", () => {
    const other = claim("it logs the reason", { line: 4 });
    const current = check({ verdicts: { [claim().id]: verdict("WRONG"), [other.id]: verdict("CORRECT") } }, [claim(), other]);
    assert.deepEqual(wrongClaims(current), [claim()]);
  });
});

describe("a lineage's chain", () => {
  it("is opened by a WRONG claim, named by its id, its words at the span given", () => {
    assert.deepEqual(mintLineage(claim(), [40, 76]), { id: claim().id, file: "README.md", places: [{ start: 40, end: 76, claim: claim().id }], chain: [] });
  });

  it("keeps where, what and when the ruling was", () => {
    const entered = enterRuling(lineage(), "r1", claim(), verdict("WRONG"), AT);
    assert.deepEqual(entered.chain, [{ ref: "r1", claim: claim().id, line: 3, words: QUOTE, ruling: "WRONG", at: AT }]);
  });

  it("takes one ruling per check and claim: entering a check's ruling again adds nothing", () => {
    let found = lineage();
    for (let i = 0; i < 2; i += 1) found = enterRuling(found, "r1", claim(), verdict("WRONG"), AT);
    assert.deepEqual(found.chain.map((entry) => entry.ref), ["r1"]);
  });

  it("takes a ruling for each half of a split claim under the one check", () => {
    let found = lineage();
    const otherHalf = claim("it logs the reason", { line: 4 });
    for (const half of [claim(), otherHalf, claim(), otherHalf]) found = enterRuling(found, "r1", half, verdict("WRONG"), AT);
    assert.deepEqual(found.chain.map(({ ref, claim: id }) => [ref, id]), [["r1", claim().id], ["r1", otherHalf.id]]);
  });

  it("loses the words of a claim ruled CORRECT: with no place left the lineage is no longer open", () => {
    const two = lineage({ places: [{ start: 0, end: 36, claim: claim().id }, { start: 40, end: 58, claim: "c2" }] });
    assert.deepEqual(enterRuling(two, "r1", claim(), verdict("CORRECT"), AT).places, [{ start: 40, end: 58, claim: "c2" }]);
    assert.deepEqual(enterRuling(lineage(), "r1", claim(), verdict("CORRECT"), AT).places, []);
    assert.equal(enterRuling(lineage(), "r1", claim(), verdict("UNSURE"), AT).places.length, 1);
  });

  it("changes nothing it is given", () => {
    const given = lineage();
    enterRuling(given, "r1", claim(), verdict("CORRECT"), AT);
    assert.deepEqual(given, lineage());
  });
});

describe("contestOutcome", () => {
  const contested = (chain: Lineage["chain"] = []) => ({ current: check({ verdicts: { [claim().id]: verdict("WRONG") } }), found: lineage({ chain }) });
  const wrongAt = (ref: string) => ({ ref, claim: claim().id, line: 3, words: QUOTE, ruling: "WRONG" as const, at: AT });

  it("enters a rejected contest as a WRONG ruling under a ref of its own", () => {
    const { current, found } = contested([wrongAt("r1")]);
    const out = contestOutcome(current, found, "r1", claim().id, verdict("WRONG"), AT);
    assert.equal(out.outcome, "rejected");
    assert.deepEqual(out.lineage.chain.map((entry) => entry.ref), ["r1", "r1/contest-1"]);
    assert.equal(out.check.contests[claim().id], "rejected");
  });

  it("numbers each contest of one claim in one check", () => {
    let { current, found } = contested([wrongAt("r1")]);
    for (let i = 0; i < 2; i += 1) ({ check: current, lineage: found } = contestOutcome(current, found, "r1", claim().id, verdict("WRONG"), AT));
    assert.deepEqual(found.chain.map((entry) => entry.ref), ["r1", "r1/contest-1", "r1/contest-2"]);
  });

  it("enters an upheld contest's ruling and replaces the check's verdict with it", () => {
    for (const kind of ["UNSURE", "CORRECT"] as const) {
      const { current, found } = contested([wrongAt("r1")]);
      const out = contestOutcome(current, found, "r1", claim().id, verdict(kind), AT);
      assert.equal(out.outcome, "upheld", kind);
      assert.deepEqual([out.lineage.chain.at(-1)?.ref, out.lineage.chain.at(-1)?.ruling], ["r1/contest-1", kind]);
      assert.equal(out.check.verdicts[claim().id].verdict, kind);
    }
  });

  it("keeps the claim's place for an UNSURE and takes it out for a CORRECT", () => {
    const { current, found } = contested([wrongAt("r1")]);
    assert.deepEqual(contestOutcome(current, found, "r1", claim().id, verdict("UNSURE"), AT).lineage.places, found.places);
    assert.deepEqual(contestOutcome(current, found, "r1", claim().id, verdict("CORRECT"), AT).lineage.places, []);
  });
});

describe("acceptContest", () => {
  const id = claim().id;

  it("accepts a contest of a WRONG claim with a path:line or an https:// page, else names what is missing", () => {
    const current = check({ verdicts: { [id]: verdict("WRONG") } });
    assert.deepEqual(acceptContest({ claim: claimRef(id), evidence: "see validator.py:2" }, current, located), { claim: id });
    assert.deepEqual(acceptContest({ claim: claimRef(id), evidence: "https://docs.example/a" }, current, located), { claim: id });
    const refused = acceptContest({ claim: claimRef(id), evidence: "I am sure it rejects" }, current, located);
    assert.ok("refused" in refused && /path:line/.test(refused.refused));
  });

  it("refuses a contest naming no claim of the check, listing its WRONG claims", () => {
    const current = check({ verdicts: { [id]: verdict("WRONG") } });
    for (const named of [id, "nope", undefined]) {
      assert.deepEqual(acceptContest({ claim: named, evidence: "validator.py:2" }, current, located), {
        refused: `${JSON.stringify(named ?? null)} is not a claim id of this check; its WRONG claims: README.md:3 "${QUOTE}" (claim-${id})`,
      });
    }
  });

  it("refuses a contest of a claim not ruled WRONG", () => {
    assert.deepEqual(acceptContest({ claim: claimRef(id), evidence: "validator.py:2" }, check({ verdicts: { [id]: verdict("CORRECT") } }), located), {
      refused: `claim-${id} is CORRECT, not WRONG`,
    });
    assert.deepEqual(acceptContest({ claim: claimRef(id), evidence: "validator.py:2" }, check(), located), {
      refused: `claim-${id} was not judged, so it has no WRONG verdict to contest`,
    });
  });

  it("lets a contest judge fetch only from a host a contest cited", () => {
    const hosts = citedHosts([{ claim: "c", evidence: "per https://docs.example/a and validator.py:2" }]);
    assert.deepEqual(hosts, ["docs.example"]);
    assert.equal(fetchAllowed("https://docs.example/other/page", hosts), true);
    assert.equal(fetchAllowed("https://evil.example/?q=secret", hosts), false);
    assert.equal(fetchAllowed("https://docs.example.evil.example/", hosts), false);
    assert.equal(fetchAllowed("http://docs.example/a", hosts), false);
    assert.equal(fetchAllowed("not a url", hosts), false);
  });
});

describe("the CORRECT memo", () => {
  it("keeps only a CORRECT verdict on a claim with no universal word", () => {
    assert.equal(cacheable(claim("The validator rejects a list"), verdict("CORRECT")), true);
    for (const word of ["every", "only", "all", "exactly", "always", "never", "Every"]) assert.equal(cacheable(claim(`it ${word} rejects`), verdict("CORRECT")), false, word);
    for (const kind of ["WRONG", "UNSURE"] as const) assert.equal(cacheable(claim(), verdict(kind)), false, kind);
  });

  it("holds while the claim keeps its category and every file it cited keeps its blob", () => {
    const memo = { category: "K1" as const, evidence_blobs: { "validator.py": "b1" }, verdict: verdict("CORRECT") };
    const blobs = (map: Record<string, string>) => (path: string) => map[path] ?? null;
    assert.equal(stillCorrect(memo, claim(), blobs({ "validator.py": "b1" })), true);
    assert.equal(stillCorrect(memo, claim(), blobs({ "validator.py": "b2" })), false);
    assert.equal(stillCorrect(memo, claim(), blobs({})), false);
    assert.equal(stillCorrect(memo, claim(QUOTE, { category: "K9" }), blobs({ "validator.py": "b1" })), false);
    assert.equal(stillCorrect({ ...memo, evidence_blobs: {} }, claim(), blobs({})), false);
  });
});
