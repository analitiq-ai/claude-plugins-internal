// Meets the contract but for `logins`, a string where a list belongs, so loading must refuse it (R18).
import type { Deps, OpenedPackage } from "../../../../src/validation/contract.ts";

export const logins = "bad-logins-bot[bot]";

export function open(_deps: Deps): OpenedPackage {
  const never = async (): Promise<never> => {
    throw new Error("a package refused at load is never called");
  };
  return { trigger: never, status: never, findings: never };
}
