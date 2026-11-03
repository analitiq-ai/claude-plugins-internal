import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative } from "node:path";
import { z } from "zod";

import { checkoutToplevel, liesUnder, type ResolvedAdrFolder } from "./adr-folders.ts";
import { couldNotRun, type CouldNotRun } from "./outcomes.ts";

export const ADR_VERSION = "0.20.0";
export const ADR_INSTALL = `npm install -g @adrkit/cli@${ADR_VERSION}`;

export type AdrAnswer = {
  /** Never a record `broken` names: a broken record is not judged. */
  governing: { recordId: string; title: string }[];
  broken: { file: string; id?: string; rule: string; message: string }[];
  notices: { id: string; matcher: string; message: string }[];
};
export type AdrScanCapped = { capped: { rule: string; message: string }[] };

/** adr check's answer is not in the shape adrkit ADR_VERSION gives; the message names what is not. */
export class AdrAnswerUnread extends Error {
  constructor(what: string) {
    super(what);
    this.name = "AdrAnswerUnread";
  }
}

// Rule names of adrkit ADR_VERSION, which exports no list of them.
const NOTICE_RULES: ReadonlySet<string> = new Set(["affects-unresolvable", "affects-repo-not-applicable"]);
const CAPPED_RULES: ReadonlySet<string> = new Set(["marker-scan-capped", "marker-declarations-capped"]);
const ERROR_SEVERITY = "error";

// Not strict: adrkit's answer carries many keys core does not read.
const Finding = z
  .object({
    rule: z.string(),
    severity: z.string(),
    message: z.string(),
    id: z.string().optional(),
    path: z.string().optional(),
    field: z.string().optional(),
    pattern: z.string().optional(),
  })
  .superRefine((finding, ctx) => {
    if (NOTICE_RULES.has(finding.rule)) {
      for (const key of ["id", "field", "pattern"] as const) {
        if (finding[key] === undefined) {
          ctx.addIssue({ code: "custom", path: [key], message: `${key} is set on every ${finding.rule} finding` });
        }
      }
    }
    if (finding.severity === ERROR_SEVERITY && finding.path === undefined) {
      ctx.addIssue({ code: "custom", path: ["path"], message: `path is set on every ${ERROR_SEVERITY} finding` });
    }
  });

const CheckOutput = z
  .object({
    ok: z.boolean(),
    governing: z.array(z.object({ recordId: z.string(), title: z.string() })),
    findings: z.array(Finding),
  })
  .superRefine((output, ctx) => {
    if (!output.ok && !output.findings.some((finding) => finding.severity === ERROR_SEVERITY)) {
      ctx.addIssue({ code: "custom", path: ["ok"], message: `ok is false only beside an ${ERROR_SEVERITY} finding` });
    }
  });

/** Pure: `adr check --json`'s output, reading its own `ok`; throws AdrAnswerUnread naming what is not as
 *  ADR_VERSION gives it. */
export function readAdrAnswer(raw: unknown): AdrAnswer | AdrScanCapped {
  const parsed = CheckOutput.safeParse(raw);
  if (!parsed.success) throw new AdrAnswerUnread(z.prettifyError(parsed.error));
  const { ok, governing, findings } = parsed.data;

  const capped = findings.filter((finding) => CAPPED_RULES.has(finding.rule));
  if (capped.length > 0) return { capped: capped.map(({ rule, message }) => ({ rule, message })) };

  // adrkit fails a check only on a changed record's error, so with `ok` every error is about some other file.
  const broken: AdrAnswer["broken"] = ok
    ? []
    : findings
        .filter((finding) => finding.severity === ERROR_SEVERITY)
        .map(({ path, id, rule, message }) => ({ file: path as string, ...(id === undefined ? {} : { id }), rule, message }));
  const brokenIds = new Set(broken.map((record) => record.id));
  return {
    governing: governing.filter((record) => !brokenIds.has(record.recordId)),
    broken,
    notices: findings
      .filter((finding) => NOTICE_RULES.has(finding.rule))
      .map(({ id, field, pattern, message }) => ({ id: id as string, matcher: `${field} "${pattern}"`, message })),
  };
}

type Ran =
  | { kind: "unstarted"; error: Error & { code?: unknown } }
  | { kind: "late" }
  | { kind: "ended"; code: number | null; signal: string | null; stdout: string; stderr: string };

function runAdr(args: readonly string[], cwd: string, timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      "adr",
      args,
      // SIGKILL, as an adr that ignores SIGTERM would outlive the deadline. Node's default 1 MiB cap would kill adr
      // mid-answer and read as adr not starting.
      { cwd, encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: Infinity },
      (error, stdout, stderr) => {
        if (error === null) resolve({ kind: "ended", code: 0, signal: null, stdout, stderr });
        else if (error.killed === true) resolve({ kind: "late" });
        // A spawn failure carries its errno name as `code`; an exit carries the status.
        else if (typeof error.code === "string") resolve({ kind: "unstarted", error });
        else resolve({ kind: "ended", code: error.code ?? null, signal: error.signal ?? null, stdout, stderr });
      },
    );
  });
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** `adr --version`, then `adr check --dir <folder> --json -- ...paths` from the realpath of `cwd`, the checkout's
 *  toplevel, killed at `deadlineMs`; `--dir` is relative to that realpath when `folder.inside`, else absolute.
 *  Never throws for the folder, only for the caller's fault: TypeError for a `deadlineMs` that is not finite and
 *  above 0, an empty `paths`, a `cwd` that is not its checkout's toplevel, or a `folder` whose `inside` is not where
 *  it lies from `cwd`; realpath's error for a `cwd` that does not exist; GitFailed for one in no git repository. */
export async function checkAdrFolder(
  cwd: string,
  folder: ResolvedAdrFolder,
  paths: readonly string[],
  deadlineMs: number,
): Promise<AdrAnswer | CouldNotRun> {
  if (!(Number.isFinite(deadlineMs) && deadlineMs > 0)) throw new TypeError(`not a deadline in ms: ${deadlineMs}`);
  if (paths.length === 0) throw new TypeError("no path to check: adr check of none passes with no record governing");
  // adr runs in the real folder, so a `--dir` made relative to a symlink would name another path. Resolved first,
  // so a spawn's ENOENT can only mean adr is missing.
  const root = await realpath(cwd);
  // `--dir`'s form comes from `folder.inside`; from below the toplevel adrkit misses a changed record, a silent pass.
  const toplevel = await checkoutToplevel(root);
  if (toplevel !== root) throw new TypeError(`adr check runs from its checkout's toplevel ${toplevel}, not ${root}`);
  if (folder.inside !== liesUnder(root, folder.path)) {
    throw new TypeError(`${folder.entry} was not resolved from ${root}: inside is ${folder.inside} for ${folder.path}`);
  }
  const notRun = (why: string): CouldNotRun => couldNotRun(folder.entry, why);
  if (!folder.readable) {
    return notRun(
      `not a readable folder, so adr was not called. Next step: make ${folder.path} a readable folder, ` +
        "or remove the entry from [shared] adr_folders.",
    );
  }

  const started = performance.now();
  const spent = new Map<string, number>();
  const step = async (name: string, args: readonly string[]): Promise<Ran> => {
    const at = performance.now();
    // A timeout of 0 is none at all to execFile, so a spent deadline still kills at once.
    const ran = await runAdr(args, root, Math.max(Math.ceil(started + deadlineMs - at), 1));
    spent.set(name, performance.now() - at);
    return ran;
  };
  const late = (): CouldNotRun => {
    const each = [...spent].map(([name, ms]) => `${name} ${seconds(ms)}`).join(", ");
    return notRun(
      `adr did not end by the check's deadline, ${deadlineMs / 1000} s after it started. Seconds each step spent: ` +
        `${each}. Next step: rerun the check.`,
    );
  };
  const unstarted = (what: string, error: Error & { code?: unknown }): CouldNotRun =>
    error.code === "ENOENT"
      ? notRun(`the adr command was not found (adrkit needs node 22 or later). Next step: ${ADR_INSTALL}.`)
      : notRun(`${what} could not be started (${error.message}). Next step: ${ADR_INSTALL}.`);

  const version = await step("adr --version", ["--version"]);
  if (version.kind === "late") return late();
  if (version.kind === "unstarted") return unstarted("adr", version.error);
  const said = version.stdout.trim();
  if (version.code !== 0 || said !== ADR_VERSION) {
    return notRun(
      `\`adr --version\` answered ${JSON.stringify(said || version.stderr.trim())}, and core reads the answer of adrkit ` +
        `${ADR_VERSION} only. Next step: ${ADR_INSTALL}.`,
    );
  }

  // adrkit 0.20.0 misses a changed record unless its folder is given relative to the folder it runs in.
  const dir = folder.inside ? relative(root, folder.path) : folder.path;
  const check = await step("adr check", ["check", "--dir", dir, "--json", "--", ...paths]);
  if (check.kind === "late") return late();
  if (check.kind === "unstarted") return unstarted("adr check", check.error);

  const failed = (): CouldNotRun => {
    const ended = check.code === null ? `was ended by ${check.signal}` : `exited ${check.code}`;
    return notRun(`adr check ${ended}: ${check.stderr.trim()} Next step: fix what adr says.`);
  };
  const unread = (what: string): CouldNotRun =>
    notRun(`adr check answered in a shape core does not read (${what}). Next step: ${ADR_INSTALL}.`);

  if (check.code !== 0 && check.code !== 1) return failed();
  let raw: unknown;
  try {
    raw = JSON.parse(check.stdout);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // Exit 1 is a check that failed on a changed record, answered on stdout like exit 0, or adrkit's own failure,
    // answered on stderr alone.
    return check.code === 1 ? failed() : unread(`its answer is not valid JSON: ${error.message}`);
  }
  let answer: AdrAnswer | AdrScanCapped;
  try {
    answer = readAdrAnswer(raw);
  } catch (error) {
    if (!(error instanceof AdrAnswerUnread)) throw error;
    return unread(error.message);
  }
  if ("capped" in answer) {
    const what = answer.capped.map(({ rule, message }) => `${message} (${rule})`).join("; ");
    return notRun(`adrkit capped its marker scan: ${what}. Next step: split the change.`);
  }
  return answer;
}
