import { lstatSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";

const MANAGED_FOLDER = "/etc/claude-code";
const MANAGED_FILE = `${MANAGED_FOLDER}/managed-settings.json`;

// contracts/key-files.md's `<K>` and `<S>`, under the home folder.
const HOME_FOLDERS = { "<K>": ".config/codeworks", "<S>": ".local/state/codeworks/reviewer" };

// The one read made where no managed settings exist: planner's own key, on the admin machine (root ADR-0008 d2, d9).
const EXEMPT = { plugin: "planner", file: "planner-app.pem" };

/** A read of a file in `~/.config/codeworks/` refused; `reasons` names every cause found. */
export class KeyReadRefused extends Error {
  readonly path: string;
  readonly reasons: readonly string[];

  constructor(path: string, reasons: readonly string[]) {
    super(`${path}: ${reasons.join("; ")}`);
    this.name = "KeyReadRefused";
    this.path = path;
    this.reasons = reasons;
  }
}

/** `<K>` and `<S>` in a list item stand for that folder written from `~` or as its absolute path. */
export type RequiredSetting =
  | { readonly setting: string; readonly equals: boolean | readonly [] }
  | { readonly setting: string; readonly holdsPaths: readonly string[] }
  | { readonly setting: string; readonly holdsRules: readonly string[] };

// SECURITY.md §5's values but those UNCHECKED_FOLDERS and UNCHECKED_SETTINGS name; a test pins them to §5.
export const REQUIRED_SETTINGS: readonly RequiredSetting[] = [
  { setting: "sandbox.enabled", equals: true },
  { setting: "sandbox.failIfUnavailable", equals: true },
  { setting: "sandbox.allowUnsandboxedCommands", equals: false },
  { setting: "sandbox.excludedCommands", equals: [] },
  { setting: "sandbox.filesystem.denyRead", holdsPaths: ["<K>", "~/.claude/.credentials.json"] },
  { setting: "sandbox.filesystem.denyWrite", holdsPaths: ["<K>", "<S>", "~/.claude", "~/.gitconfig"] },
  { setting: "sandbox.filesystem.allowManagedReadPathsOnly", equals: true },
  { setting: "sandbox.network.allowManagedDomainsOnly", equals: true },
  { setting: "sandbox.network.strictAllowlist", equals: true },
  { setting: "sandbox.network.allowAllUnixSockets", equals: false },
  {
    setting: "permissions.deny",
    holdsRules: [
      "TaskStop",
      "Read(<K>/**)",
      "Edit(<K>/**)",
      "Edit(<S>/**)",
      "Read(~/.claude/.credentials.json)",
      "Edit(~/.claude/**)",
      "Edit(~/.gitconfig)",
      "Edit(**/.claude/settings.json)",
      "Edit(**/.claude/settings.local.json)",
      "Edit(**/.claude/workflows/**)",
      "Edit(**/.claude/agents/**)",
      "Edit(**/.claude/skills/**)",
      "Edit(**/.claude/commands/**)",
      "Edit(**/.claude/hooks/**)",
      "Edit(**/.mcp.json)",
      "Edit(**/.git/config)",
      "Edit(**/.git/hooks/**)",
    ],
  },
  { setting: "allowedMcpServers", equals: [] },
  { setting: "allowManagedMcpServersOnly", equals: true },
  { setting: "allowManagedHooksOnly", equals: true },
];

// Under `allowManagedHooksOnly` every enabled plugin's hooks run, so a plugin §5 does not list must not be on.
export const ALLOWED_PLUGINS: readonly string[] = [
  "orchestrator@codeworks",
  "builder@codeworks",
  "reviewer@codeworks",
  "auditor@codeworks",
  "pr-review-toolkit@claude-plugins-official",
];

// §5's entries that stand for a per-environment path or the served repo's registries, as §5 writes them, with
// what each stands for: no gate can know their value.
export const UNCHECKED_FOLDERS: Readonly<Record<string, string>> = {
  "<V>/ghcreds": "every other credential: gh, git, SSH, cloud",
  "<V>/plugin/gaterev": "the installed plugin code and data",
  "/tmp/verify-b-ghsess": "the session's gh config folder",
};
export const UNCHECKED_SETTINGS: Readonly<Record<string, string>> = {
  env: "the package caches in `<C>`, the session's package cache folder",
  "sandbox.network.allowedDomains": "GitHub plus the registries the served repo needs",
};

export type FileStat = { readonly uid: number; readonly mode: number };

/** What a key read asks of the machine it runs on. */
export type Machine = {
  platform: string;
  /** Undefined where processes have no POSIX user id. */
  uid: number | undefined;
  home: string;
  stat(path: string): FileStat;
  lstat(path: string): FileStat;
  readText(path: string): string;
  readBytes(path: string): Buffer;
};

function thisMachine(): Machine {
  return {
    platform: process.platform,
    uid: process.getuid?.(),
    home: homedir(),
    stat: (path) => statSync(path),
    lstat: (path) => lstatSync(path),
    readText: (path) => readFileSync(path, "utf8"),
    readBytes: (path) => readFileSync(path),
  };
}

/** The one reader of `~/.config/codeworks/<file>` (R23; contracts/key-files.md). */
export function readKey(file: string, plugin: string, machine: Machine = thisMachine()): Buffer {
  const path = `${machine.home}/${HOME_FOLDERS["<K>"]}/${file}`;
  if (file === "" || file === "." || file === ".." || /[/\0]/.test(file)) {
    throw new KeyReadRefused(path, [`${JSON.stringify(file)} is not a bare file name`]);
  }
  if (!(plugin === EXEMPT.plugin && file === EXEMPT.file)) {
    const reasons = managedSettingsReasons(machine, plugin);
    if (reasons.length > 0) throw new KeyReadRefused(path, reasons);
  }
  const reasons = keyFileReasons(machine, machine.stat(path));
  if (reasons.length > 0) throw new KeyReadRefused(path, reasons);
  return machine.readBytes(path);
}

function octal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

function keyFileReasons(machine: Machine, key: FileStat): string[] {
  if (machine.uid === undefined) return [`${machine.platform} gives a process no user id to check the key's owner by`];
  const reasons: string[] = [];
  if (key.uid !== machine.uid) reasons.push(`owned by uid ${key.uid}, not the current user's ${machine.uid}`);
  if ((key.mode & 0o077) !== 0) reasons.push(`mode ${octal(key.mode)} gives group or other a permission bit`);
  return reasons;
}

function managedSettingsReasons(machine: Machine, plugin: string): string[] {
  // §5 names only the Linux path, so elsewhere there is no file to hold to it.
  if (machine.platform !== "linux") return [`managed settings are checked on Linux only, not on ${machine.platform}`];
  let file: FileStat;
  try {
    file = machine.stat(MANAGED_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [`${MANAGED_FILE} does not exist`, ...secondSourceReasons(machine)];
  }
  return [
    ...rootOnlyReasons(MANAGED_FILE, file),
    ...rootOnlyReasons(MANAGED_FOLDER, machine.stat(MANAGED_FOLDER)),
    ...secondSourceReasons(machine),
    ...settingReasons(machine.readText(MANAGED_FILE), plugin, machine.home),
  ];
}

function rootOnlyReasons(path: string, stat: FileStat): string[] {
  const reasons: string[] = [];
  if (stat.uid !== 0) reasons.push(`${path} is owned by uid ${stat.uid}, not root`);
  if ((stat.mode & 0o022) !== 0) reasons.push(`${path} has mode ${octal(stat.mode)}: group or other can write it`);
  return reasons;
}

// Claude Code merges either source over the managed file, so with one present the file is not the policy in effect
// (root ADR-0008 d9).
function secondSourceReasons(machine: Machine): string[] {
  return [`${MANAGED_FOLDER}/managed-settings.d`, `${machine.home}/.claude/remote-settings.json`].flatMap((path) => {
    try {
      machine.lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return [`${path} exists: managed settings must have one source`];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(document: Record<string, unknown>, setting: string): unknown {
  let node: unknown = document;
  for (const key of setting.split(".")) {
    if (!isRecord(node) || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

// A permission rule's absolute path starts with `//`; one `/` would make it relative to the settings file.
function spellings(item: string, home: string, absolutePrefix: string): string[] {
  for (const [placeholder, folder] of Object.entries(HOME_FOLDERS)) {
    if (item.includes(placeholder)) {
      return [`~/${folder}`, `${absolutePrefix}${home}/${folder}`].map((written) =>
        item.replace(placeholder, () => written),
      );
    }
  }
  return [item];
}

function requiredReasons(row: RequiredSetting, document: Record<string, unknown>, home: string): string[] {
  const value = valueAt(document, row.setting);
  if (value === undefined) return [`${row.setting} is missing`];
  if ("equals" in row) {
    return isDeepStrictEqual(value, row.equals)
      ? []
      : [`${row.setting} is ${JSON.stringify(value)}, not ${JSON.stringify(row.equals)}`];
  }
  if (!Array.isArray(value)) return [`${row.setting} is ${JSON.stringify(value)}, not a list`];
  const [items, absolutePrefix] = "holdsPaths" in row ? [row.holdsPaths, ""] : [row.holdsRules, "/"];
  return items.flatMap((item) => {
    const accepted = spellings(item, home, absolutePrefix);
    return accepted.some((written) => value.includes(written)) ? [] : [`${row.setting} lacks ${accepted.join(" or ")}`];
  });
}

function pluginReasons(document: Record<string, unknown>, plugin: string): string[] {
  const plugins = valueAt(document, "enabledPlugins");
  if (plugins === undefined) return ["enabledPlugins is missing"];
  if (!isRecord(plugins)) return [`enabledPlugins is ${JSON.stringify(plugins)}, not an object`];
  const own = `${plugin}@codeworks`;
  const reasons = Object.hasOwn(plugins, own) && plugins[own] === true ? [] : [`enabledPlugins does not enable ${own}`];
  for (const [name, on] of Object.entries(plugins)) {
    if (on === true && !ALLOWED_PLUGINS.includes(name)) {
      reasons.push(`enabledPlugins enables ${name}, which SECURITY.md §5 does not list`);
    }
  }
  return reasons;
}

function settingReasons(text: string, plugin: string, home: string): string[] {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return [`${MANAGED_FILE} is not JSON: ${error.message}`];
  }
  if (!isRecord(document)) return [`${MANAGED_FILE} holds ${JSON.stringify(document)}, not a JSON object`];
  return [
    ...REQUIRED_SETTINGS.flatMap((row) => requiredReasons(row, document, home)),
    ...pluginReasons(document, plugin),
  ];
}
