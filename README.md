# Spider Solitaire

Spider Solitaire for desktop and mobile browsers, styled after the Windows 7 game.
The design doc is the Claude Doc "Spider Solitaire (Web) — Design Doc".

## Play

Open `dist/index.html` in any modern browser. It's a single self-contained file
(no server needed), so it can also be uploaded as-is to any static host
(GitHub Pages, Netlify, etc.).

## Develop

Requires Node.js 20+.

```
npm install
npm run dev        # http://localhost:5173, rebuilds on every page load
npm test           # engine unit tests
npm run typecheck
npm run build      # writes dist/index.html
```

Append `?ui=touch` or `?ui=desktop` to the URL to force the mobile or desktop UI.

## Layout

```
src/
  engine/    cards.ts, rng.ts, game.ts   pure game logic (rules, scoring, undo/redo, hints, save format)
  ui/        cardface.ts, layout.ts, dialogs.ts, fireworks.ts
  services/  storage.ts (settings, saved game, statistics), audio.ts (synthesized sounds)
  app.ts     controller: rendering, pointer/touch/keyboard input, menus and dialogs
  styles.css Windows 7-style look
tests/       engine tests (node:test)
build.mjs    esbuild bundler that inlines JS + CSS into one HTML file
```
