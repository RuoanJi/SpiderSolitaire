// Builds a single self-contained dist/index.html (works from file:// or any static host).
//   node build.mjs          -> dist/index.html
//   node build.mjs --serve  -> dev server on http://localhost:5173 (rebuilds on every page load)
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const serve = process.argv.includes('--serve');

async function bundle(dev) {
  const result = await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    minify: !dev,
    format: 'iife',
    target: ['es2020', 'safari15'],
    write: false,
    outdir: 'dist',
    logLevel: 'warning',
  });
  const out = (ext) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
  const js = out('.js').replace(/<\/script/gi, '<\\/script');
  const css = out('.css');
  return readFileSync('index.html', 'utf8')
    .replace('<!--STYLE-->', () => `<style>${css}</style>`)
    .replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
}

if (serve) {
  const port = Number(process.env.PORT) || 5173;
  createServer(async (req, res) => {
    if (req.url === '/' || req.url?.startsWith('/?') || req.url === '/index.html') {
      try {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(await bundle(true));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(String(e));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  }).listen(port, () => console.log(`Spider Solitaire dev server: http://localhost:${port}`));
} else {
  mkdirSync('dist', { recursive: true });
  const html = await bundle(false);
  writeFileSync('dist/index.html', html);
  console.log(`dist/index.html (${(html.length / 1024).toFixed(1)} KB)`);
}
