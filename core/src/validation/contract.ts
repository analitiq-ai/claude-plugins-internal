import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { Finding } from "../contracts/finding.ts";
import { Time } from "../contracts/scalars.ts";
import { Round } from "../contracts/snapshot.ts";
import { assertIssueNumber, ownerAndName, type GitHubClient } from "../github.ts";
import { type Machine, readKey } from "../keys.ts";
import { couldNotRun, couldNotRunIfUnread, type CouldNotRun, type StatusAnswer } from "../outcomes.ts";
import type { Shared } from "../settings.ts";
import { CheckOutcome, ModuleName } from "../values.ts";
import { appLogins, providerThreadFindings, reviewThreads, type ProviderLogins } from "./threads.ts";

const { PENDING, PASS, FAIL, SILENT, WAIVED } = CheckOutcome.schema.enum;

// A round's head and a status's head are one thing, a PR's head commit, so they share one grammar.
const Head = Round.shape.head;

// SILENT and COULD_NOT_RUN are core's to give: a provider has no timeout of its own, and its throw is its
// could-not-run.
const PackageStatus = z.strictObject({
  outcome: CheckOutcome.schema.extract([PENDING, PASS, FAIL, WAIVED]),
  // The commit its provider read, so a verdict on another head is refused in one place for every package.
  head: Head.nullable(),
  reason: z.string().nullable(),
});
export type PackageStatus = z.infer<typeof PackageStatus>;

/** What a package's `open` is handed: it resolves no path to core and holds no credential but `readKey`'s. */
export type Deps = {
  reader: GitHubClient;
  writer: GitHubClient;
  /** core's key read for the calling plugin. */
  readKey(file: string): Buffer;
  /** The PR's unresolved threads the package's own logins started, as findings of its name. */
  providerThreads(repo: string, pr: number): Promise<Finding[]>;
};

/** What a package's `open` returns. No caller calls it directly: core's `trigger`, `status` and `findings` do. */
export type OpenedPackage = {
  /**
   * The time GitHub shows on its provider's request for the head, posted now or found, so a second call for one head
   * posts nothing; null for a provider that reviews on its own and takes no request.
   */
  trigger(repo: string, pr: number, head: string): Promise<string | null>;
  status(repo: string, pr: number, head: string): Promise<PackageStatus>;
  findings(repo: string, pr: number, head: string): Promise<Finding[]>;
};

/** A package's `validators/<name>/index.ts`; `logins` its provider's, REST form. */
export type ValidatorPackage = { logins: readonly string[]; open(deps: Deps): OpenedPackage };

// Not strict: a package may export more than the contract asks for.
const PackageExports = z.object({
  logins: z.array(z.string()),
  open: z.custom<ValidatorPackage["open"]>((open) => typeof open === "function", { error: "not a function" }),
});

const OPENED_PARTS: readonly (keyof OpenedPackage)[] = ["trigger", "status", "findings"];

/** A loaded package, with the `deps` and `shared` its answers are read with. */
export type Module = { readonly name: string; readonly opened: OpenedPackage; readonly deps: Deps; readonly shared: Shared };

/** `logins` is every loaded package's provider logins. */
export type Validators = { readonly modules: ReadonlyMap<string, Module>; readonly logins: ReadonlySet<string> };

export type LoadDeps = {
  reader: GitHubClient;
  writer: GitHubClient;
  /** The calling plugin, which every `readKey` a package makes is read for. */
  plugin: string;
  /** keys.ts's machine; absent, the one this runs on. */
  machine?: Machine;
};

/** A `[shared] validators` entry that names no package meeting the contract; `entry` is the name as listed. */
export class ValidatorLoadError extends Error {
  readonly entry: string;
  readonly why: string;

  constructor(entry: string, why: string) {
    super(`[shared] validators entry ${JSON.stringify(entry)}: ${why}`);
    this.name = "ValidatorLoadError";
    this.entry = entry;
    this.why = why;
  }
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

async function importPackage(dir: string, name: string): Promise<ValidatorPackage> {
  // The grammar comes first: a name is joined to `dir`, so one with a `/` or `..` would import from elsewhere.
  const named = ModuleName.safeParse(name);
  if (!named.success) throw new ValidatorLoadError(name, `not a module name: ${z.prettifyError(named.error)}`);
  const folder = join(dir, name);
  if (!(await statOrNull(folder))?.isDirectory()) throw new ValidatorLoadError(name, `no package folder ${folder}`);
  const index = join(folder, "index.ts");
  if (!(await statOrNull(index))?.isFile()) throw new ValidatorLoadError(name, `no ${index}`);

  const exported = PackageExports.safeParse(await import(pathToFileURL(index).href));
  if (!exported.success) throw new ValidatorLoadError(name, `its exports are refused: ${z.prettifyError(exported.error)}`);
  return exported.data;
}

function openPackage(name: string, validatorPackage: ValidatorPackage, deps: Deps): OpenedPackage {
  const opened: unknown = validatorPackage.open(deps);
  const missing = OPENED_PARTS.filter(
    (part) => typeof opened !== "object" || opened === null || typeof (opened as Record<string, unknown>)[part] !== "function",
  );
  if (missing.length > 0) throw new ValidatorLoadError(name, `its open returns no ${missing.join(", ")} function`);
  return opened as OpenedPackage;
}

/** Every `shared.validators` package's provider logins, read from its exports: no package's `open` is called. */
export async function validatorLogins(shared: Shared, dir: string): Promise<ProviderLogins> {
  const logins = new Set<string>();
  for (const name of shared.validators) for (const login of (await importPackage(dir, name)).logins) logins.add(login);
  return { logins };
}

/** Imports `<dir>/<name>/index.ts` for each `shared.validators` entry, in order, and opens it. */
export async function loadValidators(shared: Shared, dir: string, { reader, writer, plugin, machine }: LoadDeps): Promise<Validators> {
  const modules = new Map<string, Module>();
  const validators: Validators = { modules, logins: (await validatorLogins(shared, dir)).logins };
  for (const name of shared.validators) {
    const validatorPackage = await importPackage(dir, name);
    const own: ReadonlySet<string> = new Set(validatorPackage.logins);
    const deps: Deps = {
      reader,
      writer,
      readKey: (file) => readKey(file, plugin, machine),
      // `validators.logins` is every package's, so another provider's reply in this provider's thread is trusted too.
      providerThreads: async (repo, pr) =>
        providerThreadFindings(await reviewThreads(reader, repo, pr), name, own, shared, validators),
    };
    modules.set(name, { name, opened: openPackage(name, validatorPackage, deps), deps, shared });
  }
  return validators;
}

/**
 * Refuses, as TypeError, a repo, PR or head that names nothing a check could read: the caller's mistake, which a
 * package would turn into its check's COULD_NOT_RUN.
 */
export function assertAsked(repo: string, pr: number, head: string): void {
  ownerAndName(repo);
  assertIssueNumber(pr);
  assertHead(head);
}

/** A head put in a REST path as anything but a sha could name another endpoint. */
export function assertHead(head: string): void {
  if (!Head.safeParse(head).success) throw new TypeError(`not a commit sha: ${JSON.stringify(head)}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Whatever a package's check call throws is that package's COULD_NOT_RUN, a GitHub failure it met through its `deps`
// included: a package's errors are its own.

/**
 * The time of the module's request for the head, null for a provider that takes none, or COULD_NOT_RUN: the `since`
 * a caller times the module's SILENT from (orchestrator ADR-0008 d4).
 */
export async function trigger(module: Module, repo: string, pr: number, head: string): Promise<string | null | CouldNotRun> {
  assertAsked(repo, pr, head);
  let answered: unknown;
  try {
    answered = await module.opened.trigger(repo, pr, head);
  } catch (error) {
    return couldNotRun(module.name, messageOf(error), error);
  }
  const parsed = Time.nullable().safeParse(answered);
  if (!parsed.success) return couldNotRun(module.name, `its trigger answer is refused: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** `since` is the caller's start of the count, in GitHub's time; when it starts is the caller's spec. */
export type StatusWindow = { timeoutSeconds: number; since: string };

/** PASS or FAIL only for the head asked; PENDING turns SILENT once `timeoutSeconds` has run from `since`. */
export async function status(
  module: Module,
  repo: string,
  pr: number,
  head: string,
  { timeoutSeconds, since }: StatusWindow,
): Promise<StatusAnswer> {
  assertAsked(repo, pr, head);
  if (!(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0)) {
    throw new TypeError(`not a timeout in seconds: ${timeoutSeconds}`);
  }
  if (!Time.safeParse(since).success) throw new TypeError(`not GitHub's time: ${JSON.stringify(since)}`);

  let answered: unknown;
  try {
    answered = await module.opened.status(repo, pr, head);
  } catch (error) {
    return couldNotRun(module.name, messageOf(error), error);
  }
  const parsed = PackageStatus.safeParse(answered);
  if (!parsed.success) return couldNotRun(module.name, `its status answer is refused: ${z.prettifyError(parsed.error)}`);
  const answer = parsed.data;

  // A package may waive without saying why; core's WAIVED always names whose it is.
  if (answer.outcome === WAIVED) return { outcome: WAIVED, reason: answer.reason ?? `${module.name} waived` };
  if ((answer.outcome === PASS || answer.outcome === FAIL) && answer.head === head) {
    return { outcome: answer.outcome, reason: answer.reason };
  }
  // A verdict on another head is no reading of this one, so a stale verdict never passes a new head.
  const pending =
    answer.outcome === PENDING ? answer.reason : `${module.name} answered ${answer.outcome} for ${answer.head ?? "no head"}, not ${head}`;

  let now: string;
  try {
    now = await module.deps.reader.now();
  } catch (error) {
    // Without GitHub's clock, PENDING and SILENT cannot be told apart.
    return couldNotRunIfUnread(module.name, error);
  }
  const elapsed = (Date.parse(now) - Date.parse(since)) / 1000;
  if (elapsed >= timeoutSeconds) {
    return {
      outcome: SILENT,
      reason: `${module.name} gave no reading of ${head} in ${elapsed} s since ${since}; the timeout is ${timeoutSeconds} s`,
    };
  }
  return { outcome: PENDING, reason: pending };
}

/** The package's findings, its provider's threads among them, or COULD_NOT_RUN; never an empty list in its place. */
export async function findings(module: Module, repo: string, pr: number, head: string): Promise<Finding[] | CouldNotRun> {
  assertAsked(repo, pr, head);
  let answered: unknown;
  try {
    answered = await module.opened.findings(repo, pr, head);
  } catch (error) {
    return couldNotRun(module.name, messageOf(error), error);
  }
  if (!Array.isArray(answered)) return couldNotRun(module.name, `its findings answer is not a list: ${JSON.stringify(answered)}`);
  const parsed = z.array(Finding).safeParse(answered);
  if (!parsed.success) return couldNotRun(module.name, `its findings are refused: ${z.prettifyError(parsed.error)}`);
  const foreign = parsed.data.find((finding) => finding.source !== module.name);
  if (foreign !== undefined) {
    return couldNotRun(module.name, `a finding has source ${JSON.stringify(foreign.source)}, not ${JSON.stringify(module.name)}`);
  }
  // No codeworks App is trusted (root ADR-0007 d5), whichever package returns its thread.
  const apps = appLogins(module.shared);
  return parsed.data.filter((finding) => finding.thread_id === null || !apps.has(finding.author));
}
