// Builds the game for GitHub Pages (or any static host):
//   index.html             the whole game in one self-contained file (from src/index.html)
//   manifest.webmanifest   app manifest, so Android/Chrome can install it   (from src/pwa/)
//   sw.js                  service worker for offline play + update notices   (from src/pwa/)
//   icons/                 app icons                                          (from src/pwa/icons/)
//
//   node build.mjs          -> writes the files above at the project root
//   node build.mjs --serve  -> dev server on http://localhost:5173 (rebuilds on every page load)
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const serve = process.argv.includes('--serve');
const PWA = 'src/pwa';

async function bundle(dev) {
  const result = await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    minify: !dev,
    format: 'iife',
    target: ['es2020', 'safari15'],
    write: false,
    outdir: 'build-tmp', // in-memory only (write: false)
    logLevel: 'warning',
  });
  const out = (ext) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
  const js = out('.js').replace(/<\/script/gi, '<\\/script');
  const css = out('.css');
  return readFileSync('src/index.html', 'utf8')
    .replace(/<!-- Page template\.[^>]*-->\n?/, '<!-- Built by build.mjs from src/index.html — do not edit by hand. -->\n')
    .replace('<!--STYLE-->', () => `<style>${css}</style>`)
    .replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
}

/** Service worker with a version derived from everything it caches. */
function serviceWorker(html) {
  const h = createHash('sha256').update(html).update(readFileSync(join(PWA, 'manifest.webmanifest')));
  for (const f of readdirSync(join(PWA, 'icons')).sort()) h.update(readFileSync(join(PWA, 'icons', f)));
  return readFileSync(join(PWA, 'sw.js'), 'utf8').replace('__VERSION__', h.digest('hex').slice(0, 12));
}

if (serve) {
  const port = Number(process.env.PORT) || 5173;
  const types = { '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    try {
      if (path === '/' || path === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        return res.end(await bundle(true));
      }
      if (path === '/sw.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
        return res.end(serviceWorker(await bundle(true)));
      }
      const file = join(PWA, normalize(path).replace(/^([/\\])+/, ''));
      if (file.startsWith(PWA) && existsSync(file)) {
        res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
        return res.end(readFileSync(file));
      }
      res.writeHead(404);
      res.end();
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e));
    }
  }).listen(port, () => console.log(`Spider Solitaire dev server: http://localhost:${port}`));
} else {
  const html = await bundle(false);
  writeFileSync('index.html', html);
  cpSync(join(PWA, 'manifest.webmanifest'), 'manifest.webmanifest');
  cpSync(join(PWA, 'icons'), 'icons', { recursive: true });
  writeFileSync('sw.js', serviceWorker(html));
  console.log(`index.html (${(html.length / 1024).toFixed(1)} KB), manifest.webmanifest, sw.js, icons/`);
}
