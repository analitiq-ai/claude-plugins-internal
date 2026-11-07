import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DerivationError } from "../plugin/core/identity.ts";
import { specSource, type SpecDerivation } from "../plugin/lib/rules/spec-source.ts";

const STORY = 235;
const SPEC = 209;
const FOLDER = "specs/209-rebuild-reviewer-on-core";

/** Derivations answering `SPEC` as the spec's issue of `STORY` and `FOLDER` as the folder of `SPEC`; `asked` lists each call. */
function deriving(): SpecDerivation & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    specIssue: async (story) => {
      asked.push(`spec issue of #${story}`);
      return story === STORY ? SPEC : assert.fail(`asked the spec issue of #${story}`);
    },
    specFolder: async (spec) => {
      asked.push(`spec folder of #${spec}`);
      return spec === SPEC ? FOLDER : assert.fail(`asked the spec folder of #${spec}`);
    },
  };
}

function refusalOf(answer: Awaited<ReturnType<typeof specSource>>): string {
  assert.ok("refused" in answer, `expected a refusal, got ${JSON.stringify(answer)}`);
  return answer.refused;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("specSource: a round's story issue, spec issue and spec folder, from its branch (ADR-0014 d1)", () => {
  it("derives a story branch's story issue, then its spec's issue, then that issue's spec folder", async () => {
    const derive = deriving();
    assert.deepEqual(await specSource(`${STORY}-us1-ledger-rounds`, derive), { story: STORY, spec: SPEC, folder: FOLDER });
    assert.deepEqual(derive.asked, [`spec issue of #${STORY}`, `spec folder of #${SPEC}`]);
  });

  it("refuses a round on a spec branch, naming the branch and the admin's review of its spec PR, and derives nothing", async () => {
    const derive = deriving();
    const refused = refusalOf(await specSource(`${SPEC}-spec`, derive));
    assert.match(refused, new RegExp(`\`${SPEC}-spec\``));
    assert.match(refused, /an admin reviews its spec PR/);
    assert.deepEqual(derive.asked, []);
  });

  for (const branch of ["main", "0212-us1-login", "42-us1-", "42-US1-login", "feature/42-us1-login"]) {
    it(`refuses a round on ${branch}, outside the branch grammar, naming it and the story branch's form, and derives nothing`, async () => {
      const derive = deriving();
      const refused = refusalOf(await specSource(branch, derive));
      assert.match(refused, new RegExp(`\`${escaped(branch)}\``));
      assert.match(refused, /`<s>-us<k>-<slug>`/);
      assert.deepEqual(derive.asked, []);
    });
  }

  it("lets a derivation's error through unchanged: a spec folder that cannot be picked is no refusal", async () => {
    const failure = new DerivationError(`the spec folder of #${SPEC}`, `no specs/${SPEC}-*/`);
    const derive: SpecDerivation = {
      specIssue: async () => SPEC,
      specFolder: async () => {
        throw failure;
      },
    };
    await assert.rejects(specSource(`${STORY}-us1-ledger-rounds`, derive), (error: unknown) => error === failure);
  });
});
