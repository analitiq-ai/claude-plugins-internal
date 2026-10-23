# Quickstart: checking core works

Steps to check each story once it is built. None was run while planning. Needs Node 22.18 or later and npm.

## Tests (every story)

```sh
cd core
npm ci
npm test                      # tsc -p . , then node --test 'tests/**/*.test.ts'
node scripts/check-carriers.ts --base origin/main
```

The drift test fails when a file in `core/schemas/` is not what its Zod schema generates. Regenerate with `node
scripts/write-schemas.ts` and commit the result.

## US1: carrying core, and identity

1. In a scratch git repository holding a `.claude-plugin/marketplace.json`, a copy of `core/src` at `core/src`,
   and `core/tests/fixtures/carrier-plugin/` at `carrier/plugin/`, recreate its `core` link there as
   `../../core/src` (the fixture's own link, `../../../src`, points outside the copy), commit, and serve it as a
   git-hosted marketplace (research Open 1). Add it and install `carrier`.
2. Expect the installed copy under `~/.claude/plugins/cache/<marketplace>/carrier/<version>/` to hold `core/` as
   files and `node_modules/zod`. Start a session and send a prompt: the fixture's `UserPromptSubmit` hook adds
   `212` for `212-us2-retry-budget` to the context (AS1).
3. Change a file in `core/src`, commit, update the plugin without a version bump: the cached copy is unchanged.
   Bump `version`, commit, update: the new copy holds the change (AS2).
4. Delete `node_modules/zod` from the cached copy and send a prompt: the hook exits 2 naming `zod`, the prompt
   is blocked, and nothing else runs (AS3).
5. On a throwaway branch of this repo, add a carrier (`x/plugin/core` → `../../core/src`, its `package.json`,
   lockfile and `plugin.json`) and edit `core/src` without bumping it: `node scripts/check-carriers.ts --base
   origin/main` fails naming the carrier. This repo has no carrier of its own.
6. Branch grammar, from `core/`:

   ```ts
   import { parseBranch } from './src/identity.ts';
   parseBranch('212-us2-retry-budget');   // {story: 212, k: 2, slug: 'retry-budget'}
   parseBranch('145-spec');               // {spec: 145}
   parseBranch('212-us-retry');           // null
   ```

## US2: state

Against a test repo with the reviewer App installed, with a reader token and the reviewer App's token:

```ts
import { gitHub } from './src/github.ts';
import { readState } from './src/state.ts';
await readState(gitHub(readerToken), 'org/repo', 212, 'codeworks-reviewer[bot]');
```

- On an issue with a PR and no reviewer App comment: not held, no state, `attests` false (AS3).
- Edit the newest state comment in the GitHub UI and read again: `held` with `tampered`; `writeState` now throws
  `StateWriteRefused` naming the cause and its release (AS2, AS7).
- Post a comment as the reviewer App without the tag after a tagged one: `held` with `invalid` (AS2).
- With an INTERNAL round CLEAN at commit A recorded, push commit B on top: `attests` at B is true; force-push a
  history without A: false (AS11).

## US3: modules

```ts
const settings = await readSettings(gitHubTree(reader, 'org/repo', head));
for (const [name, m] of Object.entries(enabledModules(settings, reader, 'orchestrator')))
  console.log(name, await m.status(pr, head, 1800, orchestratorLogin));
await requiredChecks(settings, reader).findings(pr, head);
```

On a base branch whose ruleset requires only `internal-review`, the last call returns `{outcome: 'COULD_NOT_RUN',
…}` (AS9).

## US5: tokens

On a machine with `SECURITY.md` §5's managed settings in effect, `mintToken('reviewer', appId, 'reviewer-app.pem',
'reviewer', 'org/repo')` returns a token expiring within one hour. With it, a comment on another repo's issue and
a push to `org/repo` are both refused by GitHub (SC-008). Remove `allowManagedHooksOnly` from the managed file:
the same mint throws `KeyReadRefused` naming it; reviewer's mint reading `session-app.pem` still goes ahead, the
orchestrator's is refused (AS4).
