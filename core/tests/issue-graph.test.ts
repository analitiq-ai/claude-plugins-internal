import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GitHubUnanswered, type GitHubClient } from "../src/github.ts";
import { DerivationError } from "../src/identity.ts";
import { blockedBy, subIssues } from "../src/issue-graph.ts";
import { fakeGitHub, type FakeAnswer } from "./support/fake-github.ts";

const REPO = "acme/widgets";
const REPO_ID = "R_widgets";
const ISSUE = 212;

function inRepo(vars: Record<string, unknown>): boolean {
  return vars.owner === "acme" && vars.name === "widgets";
}

function issue(number: number, id = REPO_ID, nameWithOwner = REPO): unknown {
  return { number, repository: { id, nameWithOwner } };
}

const READS = [
  ["blockedBy", blockedBy],
  ["subIssues", subIssues],
] as const satisfies readonly (readonly [string, (reader: GitHubClient, repo: string, issue: number) => Promise<number[]>])[];

for (const [connection, read] of READS) {
  describe(connection, () => {
    // #212's `connection` in acme/widgets alone, every page; the other connection has no route, so reading it fails.
    function graph(nodes: FakeAnswer, id: FakeAnswer = { repository: { id: REPO_ID } }) {
      return fakeGitHub({
        graphql: [{ when: (query, vars) => !query.includes(`${connection}(`) && inRepo(vars), answer: id }],
        graphqlPages: [
          { when: (query, vars) => query.includes(`${connection}(`) && inRepo(vars) && vars.number === ISSUE, answer: nodes },
        ],
      });
    }

    it("is the number of every issue, read past the first page", async () => {
      const numbers = Array.from({ length: 150 }, (_, i) => 1000 + i);
      const reader = graph(numbers.map((number) => issue(number)));
      assert.deepEqual(await read(reader, REPO, ISSUE), numbers);
      const paged = reader.calls.find((call) => call.kind === "graphqlPages");
      assert.ok(paged !== undefined && paged.kind === "graphqlPages");
      assert.deepEqual(paged.vars, { owner: "acme", name: "widgets", number: ISSUE });
      assert.deepEqual(paged.connectionPath, ["repository", "issue", connection]);
    });

    it("is empty for an issue with none", async () => {
      assert.deepEqual(await read(graph([]), REPO, ISSUE), []);
    });

    it("refuses an issue in another repository, naming it, rather than read its number as one of this repository's", async () => {
      const reader = graph([issue(7), issue(3, "R_gadgets", "acme/gadgets")]);
      await assert.rejects(read(reader, REPO, ISSUE), (error: unknown) => {
        assert.ok(error instanceof DerivationError, String(error));
        assert.ok(error.message.includes("acme/gadgets#3"), error.message);
        assert.ok(error.message.includes(`${REPO}#${ISSUE}`), error.message);
        return true;
      });
    });

    it("refuses when GitHub does not answer the list, never reading it as empty", async () => {
      await assert.rejects(read(graph(new GitHubUnanswered("dummy: no answer")), REPO, ISSUE), GitHubUnanswered);
    });

    it("refuses when GitHub does not answer the repository's id", async () => {
      const reader = graph([issue(7)], new GitHubUnanswered("dummy: no answer"));
      await assert.rejects(read(reader, REPO, ISSUE), GitHubUnanswered);
    });

    it("refuses an answer that is not the shape asked for, rather than reading part of it", async () => {
      await assert.rejects(read(graph([issue(7), { number: "8" }]), REPO, ISSUE), /not the shape asked for/);
    });

    it("refuses a number that is no issue, asking GitHub nothing", async () => {
      const reader = fakeGitHub({});
      await assert.rejects(read(reader, REPO, 0), TypeError);
      assert.deepEqual(reader.calls, []);
    });
  });
}
