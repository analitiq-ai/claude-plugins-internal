# Contract: carrying core in a plugin

R3–R6; FR-001 to FR-004; root ADR-0001 d2, ADR-0009. No plugin carries core in this spec; the fixture plugin in
`core/tests/fixtures/` is the one carrier. A plugin that runs a validator module also links `validators` →
`../../validators` and pins its packages' dependencies (root ADR-0001 d2); checking that link is the first
package's spec's.

## What a carrier holds

| Path (under `<component>/plugin/`) | Content |
|---|---|
| `core` | symlink to `../../core/src`; a git-hosted marketplace install copies its target in as files |
| `package.json` | `"type": "module"`; `dependencies` holding each of `core/package.json`'s runtime dependencies at the same exact version; no `overrides` |
| `package-lock.json` | lockfile v3 from `npm install`, pinning those versions |
| `.claude-plugin/plugin.json` | a pinned `version` |

Claude Code installs the dependencies into the copied plugin at install and on each new version, registry only,
with `--ignore-scripts`; a failed install still loads the plugin.

## Importing core from a hook

```ts
import { requireDependencies, MissingDependency } from '../core/guard.ts';
try { requireDependencies(); }
catch (e) {
  if (!(e instanceof MissingDependency)) throw e;
  process.stderr.write(`core dependency ${e.name} is not installed in ${e.root}\n`);
  process.exit(2);   // the Stop hook exits 1
}
const { parseBranch } = await import('../core/identity.ts');
```

Only `guard.ts` is imported statically; it imports only `node:` modules. On `MissingDependency` the hook exits 2,
which blocks the action, names the package and runs nothing that needs core (FR-003). Every hook that runs core
is declared with `"onFailure": "block"` (Claude Code 2.1.295 or later), so a crash, a timeout or a Node that
cannot run `.ts` also blocks; without it Claude Code lets the action go ahead (R4). The Stop hook alone exits 1
and has no `onFailure`: a refused or crashed Stop hook fails open and the session ends (orchestrator ADR-0001
d5).

## What CI checks (`core/scripts/check-carriers.ts`, on every pull request and push to `main`)

| Check | Fails when |
|---|---|
| symlink | a `*/plugin/core` link does not point at `../../core/src` |
| module type | the carrier's `package.json` lacks `"type": "module"` |
| pins | a core runtime dependency is missing from the carrier's `package.json`, or its version differs from core's |
| lockfile | `package-lock.json` is missing, not `lockfileVersion` 3, or pins a core dependency at another version |
| bump | the change touches `core/src/**` or `core/package.json` `dependencies`, and a carrier's `plugin.json` `version` equals the base's; run on each PR against its base and on each push to `main` against `HEAD~1` |
| fixture | the fixture plugin's `package.json` or lockfile pins differ from core's (a core test; the glob does not reach it) |

Each failure names the carrier, the file and the expected value.

## Releasing a core change

A PR that changes `core/src/**` or core's dependency pins bumps every carrier's `version` in the same PR, and
updates each carrier's `package.json` and lockfile when a pin moved. Users get it when their plugins update. There
is no core tag and no install step.
