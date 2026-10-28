// A second provider beside `fixture`, so a test can see each provider's thread given by its own module alone
// (SC-005). Its findings are its provider's threads and nothing else.
import type { Deps, OpenedPackage } from "../../../../src/validation/contract.ts";

export const logins = ["second-bot[bot]"];

export function open(deps: Deps): OpenedPackage {
  return {
    async trigger() {},
    async status() {
      throw new Error("the second package answers no status");
    },
    async findings(repo, pr) {
      return deps.providerThreads(repo, pr);
    },
  };
}
