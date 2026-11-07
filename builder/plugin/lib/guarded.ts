// The one module every builder script imports first, so each script refuses a missing package in the same words.
// Only guard.ts is imported statically: a static import of a module that reaches a package fails to load when the
// package is missing, before the guard could name it.
import { MissingDependency, requireDependencies } from "../core/guard.ts";

try {
  requireDependencies();
} catch (e) {
  if (!(e instanceof MissingDependency)) throw e;
  process.stderr.write(`core dependency ${e.name} is not installed in ${e.root}\n`);
  process.exit(2);
}
