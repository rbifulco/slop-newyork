import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'dist');
const require = createRequire(import.meta.url);

async function sourceFiles(relativeDirectory) {
  const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  const files = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Build input cannot be a symlink: ${relative}`);
    return entry.isDirectory() ? sourceFiles(relative) : [relative];
  }));
  return files.flat();
}

// A refresh of identical source retains feedback identity. Changed review inputs,
// dependency versions, or conversion code receive a different build identity.
const inputs = [
  ...(await sourceFiles('js')),
  ...(await sourceFiles('spatial-review')),
  'spatial-review.html',
  '.well-known/spatial-review.json',
  'package-lock.json',
  'tools/build-spatial-review.mjs',
].sort();
const hash = createHash('sha256');
for (const relative of inputs) {
  hash.update(relative).update('\0').update(await readFile(path.join(root, relative))).update('\0');
}
const buildId = `slop-newyork-${hash.digest('hex').slice(0, 20)}`;

await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, '.well-known'), { recursive: true });
for (const relative of ['index.html', 'css', 'js', 'spatial-review.html', 'LICENSE']) {
  await cp(path.join(root, relative), path.join(destination, relative), { recursive: true });
}
await cp(path.join(root, '.well-known/spatial-review.json'), path.join(destination, '.well-known/spatial-review.json'));

await build({
  absWorkingDir: root,
  entryPoints: ['spatial-review/capture.mjs'],
  outfile: 'dist/spatial-review/capture.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  legalComments: 'linked',
  define: { __SPATIAL_REVIEW_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [{
    name: 'one-three-instance',
    setup(builder) {
      // Match only the bare specifier; three/tsl and three/addons retain their
      // own exports. SDK instanceof checks then use the capture's WebGPU types.
      builder.onResolve({ filter: /^three$/ }, () => ({ path: require.resolve('three/webgpu') }));
    },
  }],
});

await writeFile(path.join(destination, 'spatial-review/build.json'), `${JSON.stringify({ buildId }, null, 2)}\n`);
console.log(`Built Spatial Review ${buildId} in dist/ (ordinary index.html copied unchanged).`);
