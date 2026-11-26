import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const assetNames = ['index.html', 'styles.css', 'app.js'];
const assets = await Promise.all(assetNames.map(async name => [
  name, await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8'),
]));
await build({
  entryPoints: ['site-worker.mjs'],
  outfile: 'dist/server/index.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  loader: { '.png': 'binary' },
  define: { SITE_TEXT_ASSETS: JSON.stringify(Object.fromEntries(assets)) },
});
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
