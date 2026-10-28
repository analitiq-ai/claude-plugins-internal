// The one module every planner entry point imports first, so the hook and each script refuse a missing package
// in the same words. Only guard.ts is imported statically: any other core module would be evaluated, and fail on
// the missing package, before the guard could name it.
import { MissingDependency, requireDependencies } from "../core/guard.ts";

try {
  requireDependencies();
} catch (e) {
  if (!(e instanceof MissingDependency)) throw e;
  process.stderr.write(`core dependency ${e.name} is not installed in ${e.root}\n`);
  process.exit(2);
}
