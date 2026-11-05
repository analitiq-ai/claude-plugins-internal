import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

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

/** `text` as `schema` reads it as JSON, or what `otherwise` returns, or throws, for why it is not. */
export function jsonOf<S extends z.ZodType, F>(text: string, schema: S, otherwise: (why: string) => F): z.output<S> | F {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return otherwise(`not JSON: ${error.message}`);
  }
  const parsed = schema.safeParse(document);
  return parsed.success ? parsed.data : otherwise(z.prettifyError(parsed.error));
}

/** writeWhole of `name` in `folder`, replacing a file there, with the folder made 0700 whether or not it existed. */
export function writePrivate(folder: string, name: string, text: string): void {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // mkdir's mode does not reach a folder that already exists.
  chmodSync(folder, 0o700);
  writeWhole(join(folder, name), text, renameSync);
}

const SessionId = z.uuid();

// A UUID is a plain file name, so no session id joined to a folder names a path outside it.
export function checkSessionId(id: string): void {
  if (!SessionId.safeParse(id).success) throw new TypeError(`not a session id: ${JSON.stringify(id)}`);
}
