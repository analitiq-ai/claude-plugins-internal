// The one module every reviewer hook imports first, so each hook refuses a missing package in the same words.
// Only guard.ts is imported statically: a core module that imports a package would be evaluated, and fail when that
// package is missing, before the guard could name it.
import { MissingDependency, requireDependencies } from "../core/guard.ts";

try {
  requireDependencies();
} catch (e) {
  if (!(e instanceof MissingDependency)) throw e;
  process.stderr.write(`core dependency ${e.name} is not installed in ${e.root}\n`);
  process.exit(2);
}
