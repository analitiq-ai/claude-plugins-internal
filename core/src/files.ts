import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

// A reader of `path` never sees it part-written: `place` puts the whole temp file there, renameSync replacing an
// existing file and linkSync refusing one.
export function writeWhole(path: string, text: string, place: (temp: string, path: string) => void): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, text, { mode: 0o600, flag: "wx" });
    place(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function textIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}
