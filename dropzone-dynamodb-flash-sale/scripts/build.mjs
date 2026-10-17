/**
 * esbuild: one bundle per handler.
 *
 * Every file under src/handlers/ is a Lambda entry point. Each becomes
 * dist/handlers/<name>/index.js, so Terraform's archive_file can zip one directory per function
 * and the Lambda handler is always `index.handler`.
 *
 * Output is CommonJS even though the source is ESM. The bundle is one file either way, and CJS
 * avoids the import-attribute and top-level-await edge cases of ESM on Lambda. Each output
 * directory gets its own `package.json` with `"type": "commonjs"`, because this project's root
 * package.json says `"type": "module"` and a bare index.js would otherwise be read as ESM.
 *
 * The AWS SDK is bundled and tree-shaken rather than taken from the runtime (spec section 2), so
 * a deploy pins the SDK version instead of inheriting whatever the runtime ships that week.
 */

import { build } from 'esbuild';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const handlersDir = join(root, 'src', 'handlers');
const outDir = join(root, 'dist', 'handlers');

/** Every .ts file under src/handlers, recursively. */
async function findEntryPoints(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findEntryPoints(path)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(path);
    }
  }
  return found;
}

const entryPoints = await findEntryPoints(handlersDir);

if (entryPoints.length === 0) {
  console.error('No handlers found under src/handlers');
  process.exit(1);
}

// Function names must be unique across handler groups: they become directory and Lambda names.
const byName = new Map();
for (const entry of entryPoints) {
  const name = basename(entry, '.ts');
  const clash = byName.get(name);
  if (clash) {
    console.error(
      `Duplicate handler name "${name}": ${relative(root, clash)} and ${relative(root, entry)}`,
    );
    process.exit(1);
  }
  byName.set(name, entry);
}

await rm(outDir, { recursive: true, force: true });

const started = Date.now();

await Promise.all(
  [...byName].map(([name, entry]) =>
    build({
      entryPoints: [entry],
      outfile: join(outDir, name, 'index.js'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      // arm64 Lambdas, Node.js 22 runtime.
      mainFields: ['module', 'main'],
      sourcemap: 'linked',
      // Minifying would make CloudWatch stack traces unreadable for no meaningful cold-start win
      // at this bundle size.
      minify: false,
      treeShaking: true,
      legalComments: 'none',
      logLevel: 'warning',
      define: { 'process.env.NODE_ENV': '"production"' },
    }),
  ),
);

// Pins the bundle as CommonJS, for Node here and for the Lambda runtime in the zip.
await Promise.all(
  [...byName.keys()].map((name) =>
    writeFile(join(outDir, name, 'package.json'), `${JSON.stringify({ type: 'commonjs' })}\n`),
  ),
);

console.log(
  `Bundled ${byName.size} handler(s) in ${Date.now() - started}ms: ${[...byName.keys()].join(', ')}`,
);
