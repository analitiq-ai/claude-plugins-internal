import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeGitHub } from "../../core/tests/support/fake-github.ts";
import { GitHubUnanswered } from "../plugin/core/github.ts";
import { SettingsError } from "../plugin/core/settings.ts";
import { bootstrapAppIds, defaultBranch, settleSettings } from "../plugin/lib/settings.ts";
import {
  APP_ID,
  BOARD,
  contentsAnswer,
  REPO,
  scratchCheckout,
  SESSION_APP_ID,
  SETTINGS,
  settingsText,
  STATUS_ISSUE,
} from "./support/checkout.ts";

const SECTION = "codeworks.toml [orchestrator]";
const IDS = { app_id: APP_ID, session_app_id: SESSION_APP_ID };

function refusedAt(where: string, ...named: string[]) {
  return (error: unknown) => {
    assert.ok(error instanceof SettingsError, String(error));
    assert.equal(error.where, where);
    for (const part of named) assert.ok(error.message.includes(part), `${error.message} does not name ${part}`);
    return true;
  };
}

function settle(text: string, ref = "main") {
  const client = fakeGitHub({ rest: { [`GET /repos/acme/widgets/contents/codeworks.toml?ref=${ref}`]: contentsAnswer(text) } });
  return settleSettings(client, REPO, ref, IDS);
}

describe("bootstrapAppIds", () => {
  it("reads app_id and session_app_id from the checkout's HEAD", async (t) => {
    assert.deepEqual(await bootstrapAppIds(scratchCheckout(t)), IDS);
  });

  it("reads no other [orchestrator] key at HEAD: those come from GitHub alone", async (t) => {
    const head = settingsText(`app_id = ${APP_ID}\nsession_app_id = ${SESSION_APP_ID}\nstatus_issue = "dummy"\nunknown = 1\n`);
    assert.deepEqual(await bootstrapAppIds(scratchCheckout(t, head)), IDS);
  });

  for (const key of ["app_id", "session_app_id"]) {
    it(`refuses HEAD's [orchestrator] without ${key}, naming the section and the key`, async (t) => {
      const head = settingsText(key === "app_id" ? `session_app_id = ${SESSION_APP_ID}\n` : `app_id = ${APP_ID}\n`);
      await assert.rejects(bootstrapAppIds(scratchCheckout(t, head)), refusedAt(SECTION, key));
    });
  }

  it("refuses a HEAD with no codeworks.toml", async (t) => {
    await assert.rejects(bootstrapAppIds(scratchCheckout(t, null)), refusedAt("codeworks.toml at HEAD"));
  });
});

describe("settleSettings", () => {
  it("reads [shared] and [orchestrator] from the file on GitHub at the given ref", async () => {
    const settled = await settle(SETTINGS, "release");
    assert.equal(settled.shared.board, BOARD);
    assert.deepEqual(settled.orchestrator, { ...IDS, status_issue: STATUS_ISSUE });
  });

  it("takes status_issue from GitHub's file, whatever the checkout holds", async () => {
    const settled = await settle(settingsText(`app_id = ${APP_ID}\nsession_app_id = ${SESSION_APP_ID}\nstatus_issue = 99\n`));
    assert.equal(settled.orchestrator.status_issue, 99);
  });

  it("refuses an unknown key, naming it", async () => {
    await assert.rejects(settle(`${SETTINGS}max_turns = 3\n`), refusedAt(SECTION, "max_turns"));
  });

  for (const key of ["app_id", "session_app_id", "status_issue"]) {
    it(`refuses a missing ${key}, naming it`, async () => {
      const lines = SETTINGS.split("\n").filter((line) => !line.startsWith(`${key} =`));
      await assert.rejects(settle(lines.join("\n")), refusedAt(SECTION, key));
    });

    for (const value of ["0", "-1", "1.5", '"1"']) {
      it(`refuses ${key} = ${value}, which is no integer ≥ 1`, async () => {
        const text = SETTINGS.replace(new RegExp(`^${key} = .*$`, "m"), `${key} = ${value}`);
        await assert.rejects(settle(text), refusedAt(SECTION, key));
      });
    }
  }

  for (const [key, other] of [
    ["app_id", 7654321],
    ["session_app_id", 7654322],
  ] as const) {
    it(`refuses a ${key} on GitHub other than the one minted with, naming both values`, async () => {
      const text = SETTINGS.replace(new RegExp(`^${key} = .*$`, "m"), `${key} = ${other}`);
      await assert.rejects(settle(text), refusedAt(SECTION, key, String(other), String(IDS[key])));
    });
  }

  it("lets a GitHub no-answer through, never reading it as no file", async () => {
    const client = fakeGitHub({ rest: { "GET /repos/acme/widgets/contents/codeworks.toml?ref=main": new GitHubUnanswered("dummy: no answer") } });
    await assert.rejects(settleSettings(client, REPO, "main", IDS), GitHubUnanswered);
  });
});

describe("defaultBranch", () => {
  // Root ADR-0002 d4: work with no PR, a claim's among it, reads the file from the default branch.
  it("is the repository's default branch as GitHub names it", async () => {
    const client = fakeGitHub({ rest: { "GET /repos/acme/widgets": { default_branch: "trunk" } } });
    assert.equal(await defaultBranch(client, REPO), "trunk");
  });

  it("refuses an answer without one", async () => {
    const client = fakeGitHub({ rest: { "GET /repos/acme/widgets": {} } });
    await assert.rejects(defaultBranch(client, REPO), /not the shape asked for/);
  });
});
