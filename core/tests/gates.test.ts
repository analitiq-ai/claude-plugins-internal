import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Gates } from "../src/contracts/gates.ts";

type Fields = Record<string, unknown>;

const ANCHOR = "0123456789abcdef0123456789abcdef01234567";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";
const AT = "2026-10-28T10:00:00Z";

function site(fields: Fields = {}): Fields {
  return { file: "src/parse.ts", line: 12, function: "parse", does: "reads the header line into fields", ...fields };
}

function lineage(fields: Fields = {}): Fields {
  return {
    id: "L7",
    file: "src/parse.ts",
    places: [{ start: 120, end: 168, claim: "c1" }],
    chain: [{ ref: "t1", claim: "c1", line: 4, words: "refuses a null header", ruling: "WRONG", at: AT }],
    ...fields,
  };
}

function bug(fields: Fields = {}): Fields {
  return {
    id: "B3",
    members: [{ tree: TREE, at: AT }],
    absorbed: [],
    ranges: [{ file: "src/parse.ts", old_start: 10, old_count: 4 }],
    deep: { same_operation: [site()], callers: [site({ line: 40, function: "load" })] },
    rulings: [{ site: "src/parse.ts:load", ruling: "DEFERRED", issue: 301 }],
    ...fields,
  };
}

function gates(fields: Fields = {}): Fields {
  return { branch: "42-us1-login", anchor: ANCHOR, lineages: [], bugs: [], ...fields };
}

function accepted(value: Fields): void {
  const parsed = Gates.safeParse(value);
  if (!parsed.success) assert.fail(z.prettifyError(parsed.error));
  assert.deepEqual(parsed.data, value);
}

// Every issue's path is compared, so a refusal at any other path, or at one more, fails the test.
function refusedAt(value: Fields, ...paths: PropertyKey[][]): void {
  const parsed = Gates.safeParse(value);
  if (parsed.success) assert.fail("accepted");
  assert.deepEqual(
    parsed.error.issues.map((issue) => issue.path),
    paths,
    z.prettifyError(parsed.error),
  );
}

test("a section with no lineage and no bug is accepted", () => {
  accepted(gates());
});

test("a section holding every ruling of a claim and a site is accepted as written", () => {
  accepted(
    gates({
      lineages: [
        lineage({
          chain: [
            { ref: "t1", claim: "c1", line: 4, words: "refuses a null header", ruling: "WRONG", at: AT },
            { ref: "t2", claim: "c1", line: 4, words: "refuses a null header", ruling: "UNSURE", at: AT },
            { ref: "t3", claim: "c2", line: 9, words: "keeps the order", ruling: "CORRECT", at: AT },
          ],
        }),
        lineage({ id: "L8", places: [] }),
      ],
      bugs: [
        bug({
          absorbed: [{ tree: ANCHOR, at: AT }],
          rulings: [
            { site: "src/parse.ts:parse", ruling: "SHARES", issue: null },
            { site: "src/parse.ts:load", ruling: "NOT_SHARED", issue: null },
            { site: "src/read.ts:read", ruling: "DEFERRED", issue: 301 },
          ],
        }),
        bug({ id: "B4", deep: null, rulings: [] }),
      ],
    }),
  );
});

test("a lineage's id is unique", () => {
  refusedAt(gates({ lineages: [lineage(), lineage()] }), ["lineages", 1, "id"]);
});

test("a bug's id is unique", () => {
  refusedAt(gates({ bugs: [bug(), bug()] }), ["bugs", 1, "id"]);
});

test("a bug rules each site once", () => {
  const site = "src/parse.ts:load";
  const rulings = [
    { site, ruling: "SHARES", issue: null },
    { site, ruling: "NOT_SHARED", issue: null },
  ];
  refusedAt(gates({ bugs: [bug({ rulings })] }), ["bugs", 0, "rulings", 1, "site"]);
});

const duplicates: Array<[string, Fields, PropertyKey[]]> = [
  [
    "a chain holds one entry per check and claim",
    gates({ lineages: [lineage({ chain: [(lineage().chain as Fields[])[0], { ...(lineage().chain as Fields[])[0], line: 5, ruling: "UNSURE" }] })] }),
    ["lineages", 0, "chain", 1],
  ],
  ["a bug's members hold each tree once", gates({ bugs: [bug({ members: [{ tree: TREE, at: AT }, { tree: TREE, at: "2026-10-28T11:00:00Z" }] })] }), ["bugs", 0, "members", 1, "tree"]],
  ["a bug's absorbed trees hold each tree once", gates({ bugs: [bug({ absorbed: [{ tree: TREE, at: AT }, { tree: TREE, at: AT }] })] }), ["bugs", 0, "absorbed", 1, "tree"]],
  [
    "a deep sweep lists each same-operation site once",
    gates({ bugs: [bug({ deep: { same_operation: [site(), site({ line: 30, does: "parses again" })], callers: [] } })] }),
    ["bugs", 0, "deep", "same_operation", 1],
  ],
  [
    "a deep sweep lists each caller once",
    gates({ bugs: [bug({ deep: { same_operation: [], callers: [site(), site({ line: 30 })] } })] }),
    ["bugs", 0, "deep", "callers", 1],
  ],
];
for (const [what, value, path] of duplicates) {
  test(what, () => {
    refusedAt(value, path);
  });
}

test("a site ruling carries its issue exactly when it is DEFERRED", () => {
  for (const [ruling, issue] of [["DEFERRED", 301], ["SHARES", null], ["NOT_SHARED", null]] as const) {
    accepted(gates({ bugs: [bug({ rulings: [{ site: "src/parse.ts:load", ruling, issue }] })] }));
  }
  for (const [ruling, issue] of [["DEFERRED", null], ["SHARES", 301], ["NOT_SHARED", 301]] as const) {
    refusedAt(gates({ bugs: [bug({ rulings: [{ site: "src/parse.ts:load", ruling, issue }] })] }), ["bugs", 0, "rulings", 0, "issue"]);
  }
});

for (const [field, place, path] of [
  ["a chain's at", (at: string) => gates({ lineages: [lineage({ chain: [{ ...(lineage().chain as Fields[])[0], at }] })] }), ["lineages", 0, "chain", 0, "at"]],
  ["a member's at", (at: string) => gates({ bugs: [bug({ members: [{ tree: TREE, at }] })] }), ["bugs", 0, "members", 0, "at"]],
  ["an absorbed tree's at", (at: string) => gates({ bugs: [bug({ absorbed: [{ tree: TREE, at }] })] }), ["bugs", 0, "absorbed", 0, "at"]],
] as const) {
  test(`${field} is YYYY-MM-DDTHH:MM:SSZ, UTC, whole seconds`, () => {
    accepted(place(AT));
    for (const time of ["2026-10-28T10:00:00.000Z", "2026-10-28T10:00:00+00:00", "2026-10-28T10:00Z", "2026-10-28T10:00:00"]) {
      refusedAt(place(time), [...path]);
    }
  });
}

test("the anchor and every tree are 40 lower-case hex digits", () => {
  accepted(gates({ bugs: [bug({ absorbed: [{ tree: ANCHOR, at: AT }] })] }));
  for (const sha of [ANCHOR.toUpperCase(), ANCHOR.slice(1), `${ANCHOR}0`, `${ANCHOR.slice(1)}g`, "HEAD"]) {
    refusedAt(gates({ anchor: sha }), ["anchor"]);
    refusedAt(gates({ bugs: [bug({ members: [{ tree: sha, at: AT }] })] }), ["bugs", 0, "members", 0, "tree"]);
    refusedAt(gates({ bugs: [bug({ absorbed: [{ tree: sha, at: AT }] })] }), ["bugs", 0, "absorbed", 0, "tree"]);
  }
});

for (const key of ["file", "line", "function", "does"]) {
  test(`a deep-sweep site without ${key} is refused`, () => {
    const { [key]: _, ...partial } = site();
    refusedAt(gates({ bugs: [bug({ deep: { same_operation: [partial], callers: [] } })] }), ["bugs", 0, "deep", "same_operation", 0, key]);
    refusedAt(gates({ bugs: [bug({ deep: { same_operation: [], callers: [partial] } })] }), ["bugs", 0, "deep", "callers", 0, key]);
  });
}

test("a ruling takes only its set's values", () => {
  for (const ruling of ["MAYBE", "wrong", "SHARES"]) {
    refusedAt(gates({ lineages: [lineage({ chain: [{ ...(lineage().chain as Fields[])[0], ruling }] })] }), ["lineages", 0, "chain", 0, "ruling"]);
  }
  for (const ruling of ["shares", "WRONG"]) {
    refusedAt(gates({ bugs: [bug({ rulings: [{ site: "src/parse.ts:load", ruling, issue: null }] })] }), ["bugs", 0, "rulings", 0, "ruling"]);
  }
});

test("an unknown key is refused at every level", () => {
  refusedAt(gates({ extra: 1 }), []);
  refusedAt(gates({ lineages: [lineage({ extra: 1 })] }), ["lineages", 0]);
  refusedAt(gates({ lineages: [lineage({ places: [{ start: 1, end: 2, claim: "c1", extra: 1 }] })] }), ["lineages", 0, "places", 0]);
  refusedAt(gates({ lineages: [lineage({ chain: [{ ...(lineage().chain as Fields[])[0], extra: 1 }] })] }), ["lineages", 0, "chain", 0]);
  refusedAt(gates({ bugs: [bug({ extra: 1 })] }), ["bugs", 0]);
  refusedAt(gates({ bugs: [bug({ members: [{ tree: TREE, at: AT, extra: 1 }] })] }), ["bugs", 0, "members", 0]);
  refusedAt(gates({ bugs: [bug({ absorbed: [{ tree: TREE, at: AT, extra: 1 }] })] }), ["bugs", 0, "absorbed", 0]);
  refusedAt(gates({ bugs: [bug({ ranges: [{ file: "src/parse.ts", old_start: 10, old_count: 4, extra: 1 }] })] }), ["bugs", 0, "ranges", 0]);
  refusedAt(gates({ bugs: [bug({ rulings: [{ site: "src/parse.ts:load", ruling: "SHARES", issue: null, extra: 1 }] })] }), [
    "bugs",
    0,
    "rulings",
    0,
  ]);
  refusedAt(gates({ bugs: [bug({ deep: { same_operation: [], callers: [], extra: 1 } })] }), ["bugs", 0, "deep"]);
  refusedAt(gates({ bugs: [bug({ deep: { same_operation: [site({ extra: 1 })], callers: [] } })] }), ["bugs", 0, "deep", "same_operation", 0]);
  refusedAt(gates({ bugs: [bug({ deep: { same_operation: [], callers: [site({ extra: 1 })] } })] }), ["bugs", 0, "deep", "callers", 0]);
});
