// A package meeting the validator contract with no provider behind it: each function answers what the test sets
// in `script`. The test imports this file by the URL the loader imports it by, so both share one `script`.
import type { Finding } from "../../../../src/contracts/finding.ts";
import type { Deps, OpenedPackage, PackageStatus } from "../../../../src/validation/contract.ts";

export const logins = ["fixture-bot[bot]"];

/** What a function answers next: `answer` is returned, `throws` thrown. */
export type Scripted = { answer: unknown } | { throws: unknown };

export type Call = { fn: keyof OpenedPackage; repo: string; pr: number; head: string };

export type Script = {
  trigger: Scripted;
  status: Scripted;
  /** A list is the provider's own items, which its threads read through `deps.providerThreads` follow. */
  findings: Scripted;
  calls: Call[];
  /** The `deps` each `open` was handed, in order. */
  opened: Deps[];
};

export const script: Script = fresh();

function fresh(): Script {
  return {
    trigger: { answer: undefined },
    status: { throws: new Error("the test set no status answer") },
    findings: { answer: [] },
    calls: [],
    opened: [],
  };
}

export function reset(): void {
  Object.assign(script, fresh());
}

function play(scripted: Scripted): unknown {
  if ("throws" in scripted) throw scripted.throws;
  return scripted.answer;
}

// Answers are `unknown`, so a test can set one the contract refuses; core, not this package, refuses it.
export function open(deps: Deps): OpenedPackage {
  script.opened.push(deps);
  return {
    async trigger(repo, pr, head) {
      script.calls.push({ fn: "trigger", repo, pr, head });
      play(script.trigger);
    },
    async status(repo, pr, head) {
      script.calls.push({ fn: "status", repo, pr, head });
      return play(script.status) as PackageStatus;
    },
    async findings(repo, pr, head) {
      script.calls.push({ fn: "findings", repo, pr, head });
      const own = play(script.findings);
      if (!Array.isArray(own)) return own as Finding[];
      return [...own, ...(await deps.providerThreads(repo, pr))];
    },
  };
}
