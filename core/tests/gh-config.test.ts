import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { parse } from "yaml";

import { GhFolderRefused, needsMint, readGhToken, REFRESH_MARGIN_MS, writeGhToken } from "../src/gh-config.ts";
import type { MintedToken } from "../src/tokens.ts";

const LOGIN = "codeworks-planner[bot]";
const REPO = "acme/widgets";
const EXPIRES_AT = "2026-10-28T12:00:00Z";
const HOSTS = "hosts.yml";
const STORED = "codeworks-token.json";

function minted(value: string, repo = REPO, expiresAt = EXPIRES_AT): MintedToken {
  return { value, app: "planner", repo, expires_at: expiresAt, permissions: { contents: "write" } };
}

function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "core-gh-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("writeGhToken and readGhToken", () => {
  it("round-trip the token's value, repository and expiry", (t) => {
    const folder = join(scratch(t), "gh");
    writeGhToken(folder, minted("ghs_dummy0000000000000000000000000001"), LOGIN);
    assert.deepEqual(readGhToken(folder), {
      value: "ghs_dummy0000000000000000000000000001",
      repo: REPO,
      expires_at: EXPIRES_AT,
    });
  });

  it("make the folder 0700 and each file 0600", (t) => {
    const folder = join(scratch(t), "state", "gh");
    writeGhToken(folder, minted("ghs_dummy0000000000000000000000000002"), LOGIN);
    assert.equal(modeOf(folder), 0o700);
    assert.equal(modeOf(join(folder, HOSTS)), 0o600);
    assert.equal(modeOf(join(folder, STORED)), 0o600);
  });

  it("write hosts.yml as gh reads it: github.com's oauth_token, user and git_protocol https", (t) => {
    const folder = join(scratch(t), "gh");
    writeGhToken(folder, minted("ghs_dummy0000000000000000000000000003"), LOGIN);
    assert.deepEqual(parse(readFileSync(join(folder, HOSTS), "utf8")), {
      "github.com": { oauth_token: "ghs_dummy0000000000000000000000000003", user: LOGIN, git_protocol: "https" },
    });
  });

  it("replace an earlier token, leaving no temp file beside the two", (t) => {
    const folder = join(scratch(t), "gh");
    writeGhToken(folder, minted("ghs_dummy0000000000000000000000000004", "acme/other"), LOGIN);
    writeGhToken(folder, minted("ghs_dummy0000000000000000000000000005", REPO, "2026-10-28T13:00:00Z"), LOGIN);
    assert.deepEqual(readGhToken(folder), {
      value: "ghs_dummy0000000000000000000000000005",
      repo: REPO,
      expires_at: "2026-10-28T13:00:00Z",
    });
    assert.deepEqual(readdirSync(folder).sort(), [STORED, HOSTS]);
  });

  it("read an absent folder as null", (t) => {
    assert.equal(readGhToken(join(scratch(t), "absent")), null);
  });

  for (const kept of [HOSTS, STORED]) {
    it(`refuse a folder holding ${kept} alone, and leave it as it is`, (t) => {
      const folder = join(scratch(t), "gh");
      writeGhToken(folder, minted("ghs_dummy0000000000000000000000000006"), LOGIN);
      rmSync(join(folder, kept === HOSTS ? STORED : HOSTS));
      const before = readFileSync(join(folder, kept), "utf8");
      assert.throws(() => readGhToken(folder), (error: unknown) => {
        assert.ok(error instanceof GhFolderRefused);
        assert.ok(error.message.includes(folder), error.message);
        assert.equal(error.message.includes("ghs_dummy"), false, "the refusal shows the token");
        return true;
      });
      assert.deepEqual(readdirSync(folder), [kept]);
      assert.equal(readFileSync(join(folder, kept), "utf8"), before);
    });
  }

  // The shape gh 2.100 rewrites hosts.yml to, pinned apart from the gh on PATH, which may not rewrite it.
  it("read the hosts.yml gh rewrites, with its users map", (t) => {
    const folder = join(scratch(t), "gh");
    mkdirSync(folder, { mode: 0o700 });
    writeFileSync(
      join(folder, HOSTS),
      `github.com:\n    oauth_token: ghs_dummy0000000000000000000000000010\n    user: ${LOGIN}\n    git_protocol: https\n    users:\n        ${LOGIN}:\n            oauth_token: ghs_dummy0000000000000000000000000010\n`,
      { mode: 0o600 },
    );
    writeFileSync(join(folder, STORED), JSON.stringify({ repo: REPO, expires_at: EXPIRES_AT }), { mode: 0o600 });
    assert.deepEqual(readGhToken(folder), { value: "ghs_dummy0000000000000000000000000010", repo: REPO, expires_at: EXPIRES_AT });
  });
});

describe("needsMint", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const stored = (left: number, repo = REPO) => ({
    value: "ghs_dummy0000000000000000000000000007",
    repo,
    expires_at: new Date(now.getTime() + left).toISOString(),
  });

  it("is true with no stored token", () => {
    assert.equal(needsMint(null, REPO, now), true);
  });

  it("is true for a token of another repository", () => {
    assert.equal(needsMint(stored(30 * 60_000, "acme/other"), REPO, now), true);
  });

  it("is true with under 10 minutes left", () => {
    assert.equal(REFRESH_MARGIN_MS, 10 * 60 * 1000);
    assert.equal(needsMint(stored(10 * 60_000 - 1), REPO, now), true);
    assert.equal(needsMint(stored(-60_000), REPO, now), true);
  });

  it("is false with exactly 10 minutes left and above", () => {
    assert.equal(needsMint(stored(10 * 60_000), REPO, now), false);
    assert.equal(needsMint(stored(11 * 60_000), REPO, now), false);
    assert.equal(needsMint(stored(60 * 60_000), REPO, now), false);
  });
});

// gh reads its config folder from GH_CONFIG_DIR and a token from these variables first; HOME and XDG_* point at the
// scratch folder because gh writes state of its own there.
function ghIn(home: string, folder: string, args: readonly string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    GH_CONFIG_DIR: folder,
  };
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_HOST"]) {
    delete env[name];
  }
  return spawnSync("gh", args, { cwd: home, env, encoding: "utf8" });
}

describe("the real gh", () => {
  // gh rewrites hosts.yml the first time it reads it (it adds a `users` map), so the hook's next read and write
  // meet a folder gh has changed.
  it("prints the written token from GH_CONFIG_DIR, and the folder still reads and refreshes after gh has run", (t) => {
    const root = scratch(t);
    const home = join(root, "home");
    mkdirSync(home);
    const folder = join(root, "gh");

    writeGhToken(folder, minted("ghs_dummy0000000000000000000000000008"), LOGIN);
    const first = ghIn(home, folder, ["auth", "token"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "ghs_dummy0000000000000000000000000008\n");
    assert.equal(readGhToken(folder)?.value, "ghs_dummy0000000000000000000000000008");

    writeGhToken(folder, minted("ghs_dummy0000000000000000000000000009"), LOGIN);
    const second = ghIn(home, folder, ["auth", "token"]);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, "ghs_dummy0000000000000000000000000009\n");
    assert.ok(existsSync(join(folder, HOSTS)));
  });
});
