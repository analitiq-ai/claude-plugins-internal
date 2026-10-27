// Imports only node: modules: a carrier's hook imports this file statically, before any module that needs a
// dependency this file checks for (R4).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `name` holds the package, not the class name, so a hook can print it as it stands (contracts/carrying-core.md).
export class MissingDependency extends Error {
  readonly root: string;

  constructor(name: string, root: string) {
    super(`core dependency ${name} is not installed in ${root}`);
    this.name = name;
    this.root = root;
  }
}

// The nearest package.json is the carrier's in a plugin and core's own in this repo: the list the install used.
export function requireDependencies(): void {
  let root = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(root, 'package.json')) && dirname(root) !== root) root = dirname(root);
  const manifest: { dependencies?: Record<string, string> } = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  );
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    try {
      import.meta.resolve(name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw e;
      throw new MissingDependency(name, root);
    }
  }
}
