import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeGitHub, type FakeAnswer } from "../../core/tests/support/fake-github.ts";
import { GitHubUnanswered } from "../plugin/core/github.ts";
import type { IssueComment } from "../plugin/core/state.ts";
import { keyOf, postKeyed } from "../plugin/lib/keyed.ts";
import { ORCHESTRATOR_LOGIN, REPO } from "./support/checkout.ts";

const ISSUE = 7;
const KEY = "spec-pr-open-31";
const LINE = `<!-- codeworks:orchestrator-reason ${KEY} -->`;
const POST = "POST /repos/acme/widgets/issues/7/comments";
const ORCHESTRATOR_APP = { __typename: "Bot", login: "codeworks-orchestrator" };

function comment(databaseId: number, author: IssueComment["author"], body: string): IssueComment {
  return {
    databaseId,
    author,
    body,
    createdAt: "2026-10-30T10:00:00Z",
    lastEditedAt: null,
    url: `https://github.com/acme/widgets/issues/7#issuecomment-${databaseId}`,
  };
}

function writer(comments: FakeAnswer) {
  return fakeGitHub({
    graphqlPages: [
      {
        when: (query, vars) => /\bcomments\(/.test(query) && vars.owner === "acme" && vars.name === "widgets" && vars.number === ISSUE,
        answer: comments,
      },
    ],
    rest: { [POST]: {} },
  });
}

function posts(client: ReturnType<typeof writer>): unknown[] {
  return client.calls.flatMap((call) => (call.kind === "rest" && `${call.method} ${call.path}` === POST ? [call.body] : []));
}

const post = (client: ReturnType<typeof writer>, key = KEY) =>
  postKeyed(client, REPO, ISSUE, key, "Spec PR #31 is open: merge or close it, then move #7 back to Ready.", ORCHESTRATOR_LOGIN);

describe("postKeyed", () => {
  it("posts the reason under its key line when the issue holds none", async () => {
    const client = writer([comment(1, { __typename: "User", login: "octocat" }, "Looks good.")]);
    await post(client);
    assert.deepEqual(posts(client), [{ body: `${LINE}\nSpec PR #31 is open: merge or close it, then move #7 back to Ready.` }]);
  });

  it("posts nothing when an orchestrator App comment starts with the key line", async () => {
    const client = writer([comment(1, ORCHESTRATOR_APP, `${LINE}\nAn earlier wording.`)]);
    await post(client);
    assert.deepEqual(posts(client), []);
  });

  it("reads a key line ending in CRLF as the same line", async () => {
    const client = writer([comment(1, ORCHESTRATOR_APP, `${LINE}\r\nAn earlier wording.`)]);
    await post(client);
    assert.deepEqual(posts(client), []);
  });

  it("does not count the key line from another author, a deleted account, or below the first line", async () => {
    const client = writer([
      comment(1, { __typename: "User", login: "codeworks-orchestrator" }, `${LINE}\nCopied by a user.`),
      comment(2, { __typename: "Bot", login: "codeworks-reviewer" }, `${LINE}\nAnother App.`),
      comment(3, null, `${LINE}\nA deleted account.`),
      comment(4, ORCHESTRATOR_APP, `Quoted:\n${LINE}`),
    ]);
    await post(client);
    assert.equal(posts(client).length, 1);
  });

  it("does not count another key's line", async () => {
    const client = writer([comment(1, ORCHESTRATOR_APP, "<!-- codeworks:orchestrator-reason spec-pr-open-3 -->\nOther.")]);
    await post(client);
    assert.equal(posts(client).length, 1);
  });

  it("fails when GitHub does not answer the comment read, never reading it as no comment", async () => {
    const client = writer(new GitHubUnanswered("dummy: no answer"));
    await assert.rejects(post(client), GitHubUnanswered);
    assert.deepEqual(posts(client), []);
  });

  for (const key of ["", "Spec-PR", "spec pr", "spec--pr", "-spec", "spec-", "a -->\nb"]) {
    it(`refuses the key ${JSON.stringify(key)} before asking GitHub`, async () => {
      const client = writer([]);
      await assert.rejects(post(client, key), /not a reason key/);
      assert.deepEqual(client.calls, []);
    });
  }
});

describe("keyOf", () => {
  it("puts a cause's words in the key grammar after its prefix", () => {
    assert.equal(keyOf("session-start", "mint failed: GitHub's token for acme/widgets is refused"), "session-start-mint-failed-github-s-token-for-acme-widgets-is-refused");
  });
});
