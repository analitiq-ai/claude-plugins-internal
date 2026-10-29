import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { writeGhToken } from "../src/gh-config.ts";
import { GitFailed, PushRefused, pushWithGhCredential, runGit } from "../src/git.ts";

const COMMITTER = ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid"];

let scratch: string;
let repo: string;
let home: string;
let hookRan: string;
const savedEnv = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  PROBE_X: process.env.PROBE_X,
  GH_TOKEN: process.env.GH_TOKEN,
  GIT_ASKPASS: process.env.GIT_ASKPASS,
  SSH_ASKPASS: process.env.SSH_ASKPASS,
};

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
  // gh, run as a credential helper below, writes state of its own under these.
  process.env.XDG_STATE_HOME = join(home, ".local", "state");
  process.env.XDG_DATA_HOME = join(home, ".local", "share");
  process.env.XDG_CACHE_HOME = join(home, ".cache");
  await runGit(repo, ["init", "-q"]);
});

after(() => {
  for (const name of Object.keys(savedEnv) as (keyof typeof savedEnv)[]) restoreEnv(name);
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

  it("passes env on to git and the helpers it runs, and removes a variable env maps to undefined", async () => {
    process.env.PROBE_X = "dummy-from-parent";
    const helper = "credential.helper=!f(){ echo username=dummy; echo password=${PROBE_X-unset}; }; f";
    const set = await runGit(repo, ["-c", helper, ...credentialFill("example.invalid")], [], {
      PROBE_X: "dummy-from-env",
      GIT_TERMINAL_PROMPT: "0",
    });
    assert.match(set.stdout, /^password=dummy-from-env$/m);
    const removed = await runGit(repo, ["-c", helper, ...credentialFill("example.invalid")], [], {
      PROBE_X: undefined,
      GIT_TERMINAL_PROMPT: "0",
    });
    assert.match(removed.stdout, /^password=unset$/m);
  });

  it("with the real gh, gh's credential helper answers the login and token of a folder writeGhToken wrote", async () => {
    const folder = join(scratch, "gh-fill");
    writeGhToken(folder, dummyToken("ghs_dummy0000000000000000000000000011"), LOGIN);
    // gh reads a token from GH_TOKEN before its config folder: this one must not be the one that answers.
    process.env.GH_TOKEN = randomUUID();
    const { stdout } = await runGit(
      repo,
      ["-c", "credential.helper=!gh auth git-credential", ...credentialFill("github.com")],
      [],
      { GH_CONFIG_DIR: folder, GIT_TERMINAL_PROMPT: "0", ...NO_TOKEN_VARIABLES },
    );
    assert.match(stdout, /^username=codeworks-planner\[bot\]$/m);
    assert.match(stdout, /^password=ghs_dummy0000000000000000000000000011$/m);
  });
});

describe("pushWithGhCredential", () => {
  const ACME = { owner: "acme", name: "widgets" } as const;
  let proxy: Server;
  let proxyUrl: string;

  // Every push the guard lets through stops at this proxy, so no test reaches github.com. The user in its URL
  // makes git ask for a password gh has no answer for, which is where git turns to an askpass.
  before(async () => {
    delete process.env.GIT_ASKPASS;
    delete process.env.SSH_ASKPASS;
    proxy = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    proxyUrl = `http://dummy@127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });

  after(() => proxy.close());

  async function checkout(): Promise<string> {
    const dir = mkdtempSync(join(scratch, "push-"));
    await runGit(dir, ["init", "-q"]);
    await runGit(dir, [...COMMITTER, "commit", "-q", "--allow-empty", "-m", "dummy"]);
    await runGit(dir, ["config", "http.proxy", proxyUrl]);
    return dir;
  }

  function push(dir: string): Promise<void> {
    return pushWithGhCredential(dir, join(scratch, "gh-push"), ACME, "HEAD:refs/heads/dummy");
  }

  function refusedNaming(named: string, secret: string) {
    return (error: unknown) => {
      assert.ok(error instanceof PushRefused, String(error));
      assert.ok(error.message.includes(named), error.message);
      assert.ok(!error.message.includes(secret), error.message);
      return true;
    };
  }

  // An extra header goes out beside whatever the credential helper answers, so it could carry another credential.
  for (const template of ["http.extraHeader", "http.https://github.com/.extraHeader", "http.https://dummy:<secret>@github.com/.extraHeader"]) {
    it(`refuses a checkout whose config sets ${template}, naming the key without a credential`, async () => {
      const dir = await checkout();
      const secret = randomUUID();
      const key = template.replace("<secret>", secret);
      await runGit(dir, ["config", key, `Authorization: Basic ${secret}`]);

      await assert.rejects(push(dir), refusedNaming(key.toLowerCase().replace(`dummy:${secret}`, "***"), secret));
    });
  }

  // A rewrite moves the push off https://github.com, where gh answers, onto a transport that carries another
  // credential: git@github.com: would push with the admin's ssh key.
  for (const kind of ["insteadOf", "pushInsteadOf"]) {
    it(`refuses a checkout whose config rewrites the URL with url.<base>.${kind}, naming the URL and not the base, and pushes nothing`, async () => {
      const dir = await checkout();
      const secret = randomUUID();
      const remote = join(scratch, `${secret}.git`);
      await runGit(scratch, ["init", "-q", "--bare", remote]);
      await runGit(dir, ["config", `url.${remote}.${kind}`, "https://github.com/acme/widgets.git"]);

      await assert.rejects(push(dir), refusedNaming("https://github.com/acme/widgets.git", secret));
      const pushed = await runGit(remote, ["rev-parse", "--verify", "--quiet", "refs/heads/dummy"], [1]);
      assert.equal(pushed.code, 1, "the branch was pushed");
    });
  }

  // Where gh has no answer git asks an askpass before it gives up, and an IDE's askpass answers with the admin's
  // own credential.
  for (const source of ["GIT_ASKPASS", "SSH_ASKPASS", "core.askPass"] as const) {
    it(`runs no askpass that ${source} names, and fails`, async () => {
      const dir = await checkout();
      const ran = join(dir, "askpass-ran");
      const askpass = join(dir, "askpass");
      writeFileSync(askpass, `#!/bin/sh\ntouch '${ran}'\necho dummy\n`);
      chmodSync(askpass, 0o755);
      if (source === "core.askPass") await runGit(dir, ["config", source, askpass]);
      else process.env[source] = askpass;
      try {
        await assert.rejects(push(dir), GitFailed);
      } finally {
        delete process.env.GIT_ASKPASS;
        delete process.env.SSH_ASKPASS;
      }
      assert.equal(existsSync(ran), false, "the askpass ran");
    });
  }
});

const LOGIN = "codeworks-planner[bot]";
const NO_TOKEN_VARIABLES = {
  GH_TOKEN: undefined,
  GITHUB_TOKEN: undefined,
  GH_ENTERPRISE_TOKEN: undefined,
  GITHUB_ENTERPRISE_TOKEN: undefined,
};

function dummyToken(value: string) {
  return { value, app: "planner", repo: "acme/widgets", expires_at: "2026-10-28T12:00:00Z", permissions: {} } as const;
}

// runGit hands git no stdin, so the request `git credential fill` reads comes from an alias's shell.
function credentialFill(host: string): string[] {
  return ["-c", `alias.fill=!printf 'protocol=https\\nhost=${host}\\n\\n' | git credential fill`, "fill"];
}
