import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Guard = typeof import('../src/guard.ts');

const GUARD = fileURLToPath(new URL('../src/guard.ts', import.meta.url));
const PINS: Record<string, string> = { 'smol-toml': '1.9.1', yaml: '2.9.1', zod: '4.6.7' };

// The guard reads the package.json above its own file, so each case needs its own copy of the file in a
// carrier-shaped folder: <tmp>/plugin/{package.json, node_modules/, core/guard.ts}.
async function carrier(t: TestContext, installed: string[]): Promise<{ guard: Guard; root: string }> {
  // realpath: Node reports a module's URL with symlinks resolved, and `root` is compared against it.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'core-guard-')));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  // Listing a package nobody installed, so reading this farther package.json in place of the nearest fails.
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { 'absent-package': '1.0.0' } }));
  const root = join(tmp, 'plugin');
  mkdirSync(join(root, 'core'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', dependencies: PINS }));
  for (const name of installed) {
    const dir = join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: PINS[name], exports: './index.js' }));
    writeFileSync(join(dir, 'index.js'), '');
  }
  const copy = join(root, 'core', 'guard.ts');
  copyFileSync(GUARD, copy);
  const guard: Guard = await import(pathToFileURL(copy).href);
  return { guard, root };
}

test('all dependencies of the nearest package.json resolve: requireDependencies returns', async (t) => {
  const { guard } = await carrier(t, ['smol-toml', 'yaml', 'zod']);
  assert.equal(guard.requireDependencies(), undefined);
});

test('zod is not installed: requireDependencies throws MissingDependency naming zod and the root', async (t) => {
  const { guard, root } = await carrier(t, ['smol-toml', 'yaml']);
  assert.throws(
    () => guard.requireDependencies(),
    (e: unknown) => {
      assert.ok(e instanceof guard.MissingDependency, `expected MissingDependency, got ${String(e)}`);
      assert.equal(e.name, 'zod');
      assert.equal(e.root, root);
      return true;
    },
  );
});
