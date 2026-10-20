import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

if (args.has('--tests')) {
  const entryPoints = readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => `test/${f}`);
  await esbuild.build({ ...common, entryPoints, outdir: 'out-test', platform: 'node', format: 'cjs', sourcemap: false });
  process.exit(0);
}

const extension = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
};

const webview = {
  ...common,
  entryPoints: ['webview/src/main.tsx'],
  outfile: 'dist/webview/main.js',
  platform: 'browser',
  format: 'iife',
  loader: { '.css': 'css' },
  external: ['icon.svg'],
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
};

if (production) rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/webview', { recursive: true });
cpSync('node_modules/@vscode/codicons/dist/codicon.css', 'dist/webview/codicon.css');
cpSync('node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/webview/codicon.ttf');
cpSync('media/icon.svg', 'dist/webview/icon.svg');

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}
