// Meets the contract but for `status`, so loading must refuse it (R18).
import type { Deps, OpenedPackage } from "../../../../src/validation/contract.ts";

export const logins = ["no-status-bot[bot]"];

export function open(_deps: Deps): Omit<OpenedPackage, "status"> {
  return {
    async trigger() {
      throw new Error("a package refused at load is never triggered");
    },
    async findings() {
      throw new Error("a package refused at load is never read");
    },
  };
}
