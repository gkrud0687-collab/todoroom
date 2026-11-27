import { build } from 'esbuild';

await build({
  entryPoints: { pet: 'src/pet.js', todo: 'src/todo.js', setup: 'src/setup.js', report: 'src/report.js' },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  minify: true,
  sourcemap: false,
  loader: { '.json': 'json' },
  logLevel: 'info',
});
