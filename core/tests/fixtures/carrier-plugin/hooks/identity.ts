// Only guard.ts is imported statically: a static import of any other core module would be evaluated, and fail on
// a missing package, before the guard could name it (contracts/carrying-core.md).
import { MissingDependency, requireDependencies } from "../core/guard.ts";

try {
  requireDependencies();
} catch (e) {
  if (!(e instanceof MissingDependency)) throw e;
  process.stderr.write(`core dependency ${e.name} is not installed in ${e.root}\n`);
  process.exit(2);
}

const { parseBranch } = await import("../core/identity.ts");
const branch = parseBranch("212-us2-retry-budget");
if (branch === null || !("story" in branch)) throw new Error("212-us2-retry-budget does not parse as a story branch");
process.stdout.write(`${branch.story}\n`);
