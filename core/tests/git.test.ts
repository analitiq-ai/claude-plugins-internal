import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { GitFailed, runGit } from "../src/git.ts";

const COMMITTER = ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid"];

let scratch: string;
let repo: string;
let home: string;
let hookRan: string;
const savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

function restoreEnv(name: keyof typeof savedEnv): void {
  const value = savedEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "core-git-"));
  repo = join(scratch, "repo");
  home = join(scratch, "home");
  hookRan = join(scratch, "hook-ran");
  const hooks = join(scratch, "hooks");
  mkdirSync(repo);
  mkdirSync(home);
  mkdirSync(hooks);
  writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\ntouch '${hookRan}'\n`);
  chmodSync(join(hooks, "pre-commit"), 0o755);
  writeFileSync(join(home, ".gitconfig"), `[user]\n\tname = Global Dummy\n[core]\n\thooksPath = ${hooks}\n`);
  // runGit passes its own environment on to git, so this is how a user's global config reaches the child.
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  await runGit(repo, ["init", "-q"]);
});

after(() => {
  restoreEnv("HOME");
  restoreEnv("XDG_CONFIG_HOME");
  rmSync(scratch, { recursive: true, force: true });
});

describe("runGit", () => {
  it("returns code 0 and stdout when git exits 0", async () => {
    assert.deepEqual(await runGit(repo, ["rev-parse", "--is-inside-work-tree"]), { code: 0, stdout: "true\n" });
  });

  it("returns an exit code the caller names in answers", async () => {
    assert.deepEqual(await runGit(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/absent"], [1]), {
      code: 1,
      stdout: "",
    });
  });

  it("throws GitFailed(args, code, stderr) for an exit code outside 0 and answers", async () => {
    const args = ["rev-parse", "--verify", "refs/heads/absent"];
    await assert.rejects(runGit(repo, args, [1]), (error: unknown) => {
      assert.ok(error instanceof GitFailed);
      assert.deepEqual(error.args, args);
      assert.equal(error.code, 128);
      assert.match(error.stderr, /Needed a single revision/);
      return true;
    });
  });

  it("reads no global config: user.name from HOME's .gitconfig is not seen", async () => {
    const plain = execFileSync("git", ["-C", repo, "config", "user.name"], {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    });
    assert.equal(plain, "Global Dummy\n", "fixture: plain git reads the temp HOME's .gitconfig");
    assert.deepEqual(await runGit(repo, ["config", "user.name"], [1]), { code: 1, stdout: "" });
  });

  it("runs no hook from the global core.hooksPath on a commit", async () => {
    const control = mkdtempSync(join(scratch, "control-"));
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
    execFileSync("git", ["-C", control, "init", "-q"], { env });
    execFileSync("git", ["-C", control, ...COMMITTER, "commit", "-q", "--allow-empty", "-m", "control"], { env });
    assert.ok(existsSync(hookRan), "fixture: plain git runs the global pre-commit hook");
    rmSync(hookRan);

    await runGit(repo, [...COMMITTER, "commit", "-q", "--allow-empty", "-m", "dummy"]);
    assert.equal(existsSync(hookRan), false);
    assert.equal((await runGit(repo, ["rev-list", "--count", "HEAD"])).stdout, "1\n");
  });

  it("gives git GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1", async () => {
    const probe = "alias.probe=!printenv GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM";
    assert.deepEqual(await runGit(repo, ["-c", probe, "probe"]), { code: 0, stdout: "/dev/null\n1\n" });
  });

  it("gives git -c credential.helper=, -c core.fsmonitor=false and -c core.hooksPath=/dev/null", async () => {
    const { stdout } = await runGit(repo, ["config", "--show-scope", "--list"]);
    const fromCommandLine = stdout.split("\n").filter((line) => line.startsWith("command\t"));
    for (const setting of ["credential.helper=", "core.fsmonitor=false", "core.hookspath=/dev/null"]) {
      assert.ok(fromCommandLine.includes(`command\t${setting}`), `missing -c ${setting} in ${stdout}`);
    }
  });
});
