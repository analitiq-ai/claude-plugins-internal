import { isPlainPath } from "./tree.ts";

// The paths that configure, run or govern the review of the PR that changes them (orchestrator ADR-0004 d4), as
// segments in folded case.
const PROTECTED: readonly (readonly string[])[] = [
  ["codeworks.toml"],
  [".github"],
  [".claude"],
  [".specify", "memory"],
  ["docs", "adr"],
  ["agents.md"],
  ["claude.md"],
];

// Lower case alone keeps ſ, whose upper case is S, apart from s.
function folded(segment: string): string {
  return segment.toUpperCase().toLowerCase();
}

function protectedPathOf(changedFile: string): string | null {
  const segments = changedFile.split("/");
  const keys = segments.map(folded);
  for (let start = 0; start < keys.length; start++) {
    const match = PROTECTED.find((path) => path.every((segment, i) => keys[start + i] === segment));
    if (match !== undefined) return segments.slice(0, start + match.length).join("/");
  }
  return null;
}

/**
 * The protected paths, at any depth and in any letter case, that `changedFiles` touch, each spelt as the PR spells
 * it, once, in path order. A file touches the outermost protected path it is or lies under. A moved file is a
 * changed file under both its paths.
 */
export function protectedPaths(changedFiles: readonly string[]): string[] {
  const touched = new Set<string>();
  for (const changedFile of changedFiles) {
    if (!isPlainPath(changedFile)) throw new TypeError(`not a changed file path inside the tree: ${JSON.stringify(changedFile)}`);
    const path = protectedPathOf(changedFile);
    if (path !== null) touched.add(path);
  }
  return [...touched].sort();
}
