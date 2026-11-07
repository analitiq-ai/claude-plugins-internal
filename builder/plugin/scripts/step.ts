// Anything this script needs past the guard is loaded with `await import(...)`: a static import that reaches a
// package fails to load when the package is missing, before the guard could name it.
import "../lib/guarded.ts";

export type StepIo = { stderr: (line: string) => void };

export function main(_args: readonly string[], io: StepIo): number {
  io.stderr("builder: step.ts is not built yet");
  return 2;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2), { stderr: (line) => process.stderr.write(`${line}\n`) });
}
