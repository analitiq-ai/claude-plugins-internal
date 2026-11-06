import { parse, TomlError } from "smol-toml";
import { z } from "zod";

import { NotInTree, type Tree } from "./tree.ts";
import { ModuleName } from "./values.ts";

export const SETTINGS_FILE = "codeworks.toml";

/** The `where` of a `SettingsError` that refuses the `[shared]` section. */
export const SHARED_SECTION = `${SETTINGS_FILE} [shared]`;

/** `codeworks.toml` is missing or unparsable, or its `[shared]` section is refused; `where` names which. */
export class SettingsError extends Error {
  readonly where: string;
  readonly why: string;

  constructor(where: string, why: string, options?: ErrorOptions) {
    super(`${where}: ${why}`, options);
    this.name = "SettingsError";
    this.where = where;
    this.why = why;
  }
}

// GitHub's login characters, `_` included for an enterprise-managed user's suffix; one grammar for a board's
// owner, an App's slug and a trusted reviewer.
const LOGIN = "[A-Za-z0-9][A-Za-z0-9_-]*";

// Every read compares an App's login in REST form, so a login without `[bot]` would match no comment or thread.
const AppLogin = z.string().regex(new RegExp(`^${LOGIN}\\[bot\\]$`));

// GraphQL's `ProjectV2.url` has exactly this form, and the release rule compares it to `board` as text.
const BOARD = new RegExp(`^https://github\\.com/(?:orgs|users)/${LOGIN}/projects/[1-9][0-9]*$`);

function listedOnce<Item extends z.ZodType>(item: Item) {
  return z.array(item).superRefine((items, ctx) => {
    items.forEach((value, i) => {
      if (items.indexOf(value) !== i) {
        ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} is listed more than once`, path: [i] });
      }
    });
  });
}

export const Shared = z.strictObject({
  validators: listedOnce(ModuleName),
  // Required though it may be empty, so a repo that forgot it is refused rather than checked against nothing.
  adr_folders: listedOnce(z.string().min(1)),
  // Absent, not empty, is what makes the threads module refuse to run.
  trusted_reviewers: z.array(z.string().regex(new RegExp(`^${LOGIN}(?:\\[bot\\])?$`))).optional(),
  // For a repo whose GitHub plan offers no rulesets: set, it stands in for the base branch's rules, which are then
  // not read (#174 R22).
  required_checks: listedOnce(z.string().min(1)).min(1).optional(),
  board: z.string().regex(BOARD),
  session_app_login: AppLogin,
  orchestrator_app_login: AppLogin,
  reviewer_app_login: AppLogin,
  planner_app_login: AppLogin,
});
export type Shared = z.infer<typeof Shared>;

export type Settings = {
  shared: Shared;
  /** A component's own section as parsed, `{}` when the file has none; the component validates it (root ADR-0002 d2). */
  section(name: string): unknown;
};

// No environment variable is read: a key has one source, the file at the ref (root ADR-0002 d3).
async function tablesOf(tree: Tree): Promise<(name: string) => unknown> {
  let text: string;
  try {
    text = await tree.readText(SETTINGS_FILE);
  } catch (error) {
    if (!(error instanceof NotInTree)) throw error;
    throw new SettingsError(`${SETTINGS_FILE} at ${error.ref}`, "the ref holds no such file", { cause: error });
  }

  let document: Record<string, unknown>;
  try {
    // A section is handed over unvalidated, so a `__proto__` or `constructor` key would reach a component that
    // copies it onto an object of its own.
    document = parse(text, { unsafeKeyBehaviour: "throw" });
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    throw new SettingsError(SETTINGS_FILE, error.message, { cause: error });
  }
  return (name) => (Object.hasOwn(document, name) ? document[name] : undefined);
}

export async function readSettings(tree: Tree): Promise<Settings> {
  const tableAt = await tablesOf(tree);
  const shared = Shared.safeParse(tableAt("shared"));
  if (!shared.success) {
    throw new SettingsError(SHARED_SECTION, z.prettifyError(shared.error), { cause: shared.error });
  }
  return { shared: shared.data, section: (name) => tableAt(name) ?? {} };
}

/**
 * One component's section as parsed, `{}` when the file has none, with `[shared]` not judged: for keys read at a
 * ref whose `[shared]` the installed core may not accept, such as a story branch that changes it.
 */
export async function readSection(tree: Tree, name: string): Promise<unknown> {
  return (await tablesOf(tree))(name) ?? {};
}
