import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { runGit } from "./git.ts";
import { SettingsError, SHARED_SECTION, type Shared } from "./settings.ts";

export type ResolvedAdrFolder = { entry: string; path: string; inside: boolean; readable: boolean };

// What makes a path no readable folder rather than a fault of core's: such an entry is returned as not readable,
// and the check that reads it reports that.
const NOT_REACHABLE = new Set(["ENOENT", "ENOTDIR", "EACCES", "ELOOP"]);

function unreachable(error: unknown): boolean {
  return NOT_REACHABLE.has((error as NodeJS.ErrnoException).code ?? "");
}

function liesUnder(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// `--path-format=absolute` makes git answer the realpath, so `inside` compares realpaths on both sides.
async function gitPath(checkout: string, question: string): Promise<string> {
  return (await runGit(checkout, ["rev-parse", "--path-format=absolute", question])).stdout.replace(/\n$/, "");
}

async function realPathIfPresent(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!unreachable(error)) throw error;
    return path;
  }
}

async function isReadableFolder(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isDirectory()) return false;
    await access(path, constants.R_OK | constants.X_OK);
    return true;
  } catch (error) {
    if (!unreachable(error)) throw error;
    return false;
  }
}

function located(entry: string, mainCheckout: string, checkoutRoot: string): string {
  if (isAbsolute(entry)) return resolve(entry);
  // Relative to the main checkout, so a folder beside the repo is one folder from every worktree.
  const fromMain = resolve(mainCheckout, entry);
  // An in-repo folder is the calling checkout's own, so a record its branch adds is seen.
  return liesUnder(mainCheckout, fromMain) ? resolve(checkoutRoot, relative(mainCheckout, fromMain)) : fromMain;
}

/** Each `[shared] adr_folders` entry resolved from `checkout`, in list order. Throws SettingsError (SHARED_SECTION)
 *  when two entries are one folder, naming both; GitFailed when `checkout` is not in a git repository.
 *  Reads no env var, makes no network call. */
export async function adrFolders(checkout: string, shared: Shared): Promise<ResolvedAdrFolder[]> {
  const [commonDir, checkoutRoot] = await Promise.all([gitPath(checkout, "--git-common-dir"), gitPath(checkout, "--show-toplevel")]);
  const mainCheckout = dirname(commonDir);

  const resolved = await Promise.all(
    shared.adr_folders.map(async (entry): Promise<ResolvedAdrFolder> => {
      const path = await realPathIfPresent(located(entry, mainCheckout, checkoutRoot));
      return { entry, path, inside: liesUnder(checkoutRoot, path), readable: await isReadableFolder(path) };
    }),
  );

  const entryAt = new Map<string, string>();
  for (const { entry, path } of resolved) {
    const first = entryAt.get(path);
    if (first !== undefined) {
      throw new SettingsError(SHARED_SECTION, `adr_folders lists ${JSON.stringify(first)} and ${JSON.stringify(entry)}, which are one folder, ${path}`);
    }
    entryAt.set(path, entry);
  }
  return resolved;
}
