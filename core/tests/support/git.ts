import { execFileSync } from "node:child_process";

/**
 * git's trimmed output in `root`, with no machine or user config and a dummy author. Of the environment only PATH and
 * HOME reach it: a GIT_DIR set where the tests run would take git to that repository instead of `root`.
 */
export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, "-c", "user.name=Dummy", "-c", "user.email=dummy@example.invalid", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
}
