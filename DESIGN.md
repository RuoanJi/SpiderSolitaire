# Spider Solitaire (Web) — Design Doc

**Status:** Draft v0.1  **Author:** Ruoan (with Claude)  **Date:** 2026-11-19

## 1. Goal

A web Spider Solitaire that looks and feels like the version that shipped with Windows 7 and plays equally well with a mouse on desktop and with touch on a phone or tablet.

### Non-goals (v1)

- Other solitaire variants (Klondike, FreeCell).
- Accounts, cloud sync, leaderboards, multiplayer.
- Pixel copies of Microsoft's artwork. We aim for the *look* (green felt, glossy cards, Aero-style chrome, fireworks), but draw our own cards, icons and sounds. The Windows card art, logos and sounds are copyrighted.

## 2. Game rules (matching Windows 7)

| Item | Rule |
|---|---|
| Deck | 104 cards (2 decks). The suit mix depends on difficulty. |
| Difficulty | **Beginner:** 1 suit (8 × ♠). **Intermediate:** 2 suits (4 × ♠, 4 × ♥). **Advanced:** 4 suits (2 of each). |
| Tableau | 10 columns. Columns 1–4 get 6 cards and 5–10 get 5 cards (54 total). Only the top card of each column is face up. |
| Stock | The 50 remaining cards, dealt in 5 rounds of 10 (one card onto each column). |
| Deal restriction | You can't deal while any column is empty. |
| Moving | Any face-up card can go on a card one rank higher, **of any suit**. A run can move as a unit only if it is in descending order **and all one suit**. Any card or valid run can go into an empty column. |
| Flip | When a face-down card is uncovered, it turns face up automatically. |
| Completing | A full K→A run of one suit is removed automatically to the foundation area. |
| Win | All 8 runs are completed. |

### Scoring (Windows 7)

- Start at **500**.
- **−1** per move. Undo also counts as a move.
- **+100** per completed suit run.
- Shown in the status bar along with **Moves** and **Time**.

## 3. Feature list

### P0 — MVP

1. Deal a new game at the chosen difficulty, using a seeded random generator.
2. Drag and drop cards and runs, with rule checking and an animated snap-back when a drop is invalid.
3. Tap or click to auto-move (see §4.3).
4. Deal from the stock by clicking the stock pile, or pressing `D`.
5. Automatic flip and automatic removal of completed runs, with animation.
6. Unlimited **Undo** (`Ctrl+Z`), including undoing deals.
7. **Hint** (`H`): highlights a source card and its destination. Pressing it again cycles through other moves. If no move exists, it says "Deal a new row" or "No moves available".
8. Score, moves and timer in the status bar.
9. A win screen (fireworks) with the final score and a "Play again" option.
10. A **No more moves** dialog: *New game · Restart this game · Undo*.
11. Auto-save the game in progress (`localStorage`) and resume it on reload.
12. A responsive layout for desktop, tablet, and phones in both orientations.

### P1

13. **Statistics** for each difficulty: games played, won, win %, high score, longest win streak, longest losing streak, current streak. Includes a reset button.
14. **Options:** difficulty, play animations, play sounds, show tips, always continue saved games, always save game on exit.
15. **Change Appearance:** choice of card back and background (felt colours).
16. Sound effects for card pick-up, drop, deal, run completed, and win. Off by default on mobile.
17. **Restart this game** (same deal).
18. Full keyboard play (§4.4).

### P2 (nice to have)

19. Play offline and install to the home screen (PWA).
20. Game numbers or shareable seeds ("Game #12345").
21. A four-colour suits option for accessibility.
22. Haptic feedback on drop and complete (Android, where `navigator.vibrate` works).

## 4. Interaction design

All input goes through **Pointer Events**, so mouse, touch and pen share one code path. Keyboard input is a separate layer that calls the same game actions.

### 4.1 Drag and drop (desktop and touch)

- **Pointer down** on a face-up card. If that card and everything below it form a movable run, the run is picked up. If not, nothing is picked up, and on touch the card gives a small shake.
- **Drag threshold:** 4 px with a mouse, 8 px with touch. Below the threshold, releasing the pointer counts as a **tap/click** (§4.3).
- While dragging, the run follows the pointer, offset by where it was grabbed, and gets a lifted shadow. On touch, the run is also raised about 20 px so the finger doesn't hide it.
- **Drop target:** the column whose top card's rectangle overlaps the dragged card the most. Ties go to the column nearest the pointer's x position. Valid targets highlight while you hover over them.
- **Invalid drop:** the run animates back to where it came from (~150 ms). The score doesn't change.
- `touch-action: none` on the play area stops scrolling and pinch-zoom during a drag.

### 4.2 Stock / deal

- Click or tap the stock (bottom right) to deal. The number of deals left is shown as stacked card backs, up to 5.
- If any column is empty, nothing is dealt. Instead the empty columns flash and a message says *"You can't deal while there are empty columns."*

### 4.3 Tap-to-move (important for mobile)

A single tap or click on a movable card moves it automatically to the best destination, in this priority order:

1. A card one rank higher **of the same suit** (this builds a suited run).
2. A card one rank higher of any suit.
3. An empty column, but only if the run doesn't already start a column, so the move does something useful.

Tapping the same card again within 2 seconds undoes that move and tries the next destination, so you can cycle through the options. If there is no destination, the card shakes.

Alternatively, **two-tap select** (an option, off by default): the first tap selects the run and outlines it, and the second tap on a column moves it there.

### 4.4 Keyboard

| Key | Action |
|---|---|
| `F2` | New game |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `H` | Hint |
| `D` | Deal |
| `F3` | Statistics |
| `F4` | Change appearance |
| `F5` | Options |
| `←` `→` | Move focus between columns |
| `↑` `↓` | Change how many cards are selected within the focused column |
| `Enter` / `Space` | Pick up, then drop on the focused column |
| `Esc` | Cancel the pick-up or close the dialog |

### 4.5 Feedback and animation

- Every animation can be turned off with the *Play animations* option and is shortened when `prefers-reduced-motion` is set.
- Deal: cards fly from the stock to each column one after another (~40 ms apart).
- Completed run: the cards collapse and fly to the next foundation slot (bottom left).
- Win: fireworks drawn on a canvas, then the win dialog.

## 5. Layout and visual style

### 5.1 Windows 7 look

- **Background:** a deep green felt gradient with a slight noise texture (an alternative colour can be chosen in Change Appearance).
- **Chrome:** a menu bar styled like Aero (Game · Help) on desktop, with a translucent glass gradient and rounded dialogs.
- **Cards:** white faces with rounded corners, large readable corner indices, original pip layouts and original face-card art that we make ourselves. Glossy card backs in a few colour options.
- **Status bar** (bottom centre on desktop): `Score: 500 Moves: 0 Time: 0:00`.
- **Foundation:** completed runs stack as Kings at the bottom left, slightly overlapping. **Stock:** at the bottom right.

### 5.2 Responsive sizing

Card width is calculated from the viewport:

```
cardW = min( (viewportW − margins) / 10.6 , (viewportH − chrome) / 5.2 )
cardH = cardW × 1.4
```

- Face-down cards fan at about 12% of card height and face-up cards at about 25%.
- **Column compression:** if a column would run past the bottom of the screen, its fan offsets shrink (face-down cards first) so it always fits without scrolling.
- **Phone, portrait** (~390 px wide → cards about 34 px wide): this is the hardest case.
  - Use larger corner indices that take up most of the visible strip of each card, and leave out the centre pips.
  - Replace the menu bar with a bottom toolbar: **New · Undo · Hint · Deal · ⋯** (the ⋯ menu holds stats, options and appearance). Buttons are at least 44 × 44 px.
  - Show a one-time tip suggesting landscape for a roomier layout. Portrait still has to be fully playable.
- **Phone, landscape / tablet / desktop:** the full Windows 7 layout.
- Respect `env(safe-area-inset-*)` for notches and home indicators.

## 6. Architecture

```
src/
  engine/        pure TypeScript, no DOM
    cards.ts     card model, deck building per difficulty
    rng.ts       seeded PRNG (mulberry32)
    state.ts     GameState (tableau, stock, foundations, score, moves)
    rules.ts     isMovableRun, canDrop, canDeal, findCompletedRun
    actions.ts   move, deal, undo/redo (command pattern + history stack)
    hints.ts     enumerate & rank legal moves; detect "no moves"
  ui/
    render.ts    DOM renderer (absolutely-positioned card elements, CSS transforms)
    layout.ts    responsive metrics & column compression
    input.ts     pointer drag/tap, keyboard focus model
    anim.ts      animation helpers (Web Animations API)
    dialogs.ts   new game, stats, options, appearance, win, no-moves
    fireworks.ts canvas win effect
  services/
    storage.ts   save/load game, stats, settings (versioned JSON in localStorage)
    audio.ts     Web Audio sound playback
  assets/        original SVG card faces/backs, felt textures, sounds
```

**Key decisions:**

- **DOM + CSS transforms, not canvas,** for the cards. That gives us easy hit-testing, crisp SVG at any zoom level, accessibility (ARIA labels such as "7 of Hearts"), and GPU-accelerated animation. 104 elements is a small number.
- **The engine is pure and deterministic.** The UI dispatches actions and re-renders from the state. This makes the engine fully unit-testable and makes undo simple.
- **Tooling:** Vite + TypeScript + Vitest. No UI framework is needed. Static hosting (for example GitHub Pages or Netlify).

## 7. Edge cases

- Undoing a completed run puts its 13 cards back on the tableau, and the score reverses the +100.
- An undo is itself counted as a move (−1), following Windows 7. Redo is the same.
- Hint detection ignores pointless moves, such as moving a run back and forth between two equivalent spots.
- Resizing or rotating the screen during a drag cancels the drag and re-runs the layout.
- A second pointer (multi-touch) during a drag is ignored.
- Saves carry a version number. A save that can't be loaded is discarded and a fresh game starts.

## 8. Accessibility

- Keyboard play covers the whole game (§4.4). Visible focus rings.
- Cards have ARIA labels, and moves and completed runs are announced through a live region.
- Colour contrast meets WCAG AA. Optional four-colour suits.
- Reduced-motion support.

## 9. Testing

- **Unit tests** (Vitest) for the engine: dealing per difficulty, run validity, deal restriction, completion detection, scoring, undo/redo round trips, hints.
- **Interaction tests** (Playwright) on desktop Chrome plus emulated iPhone and Pixel: drag, tap-to-move, deal, undo, win flow.
- **Manual checks** on a real iOS Safari device and a real Android Chrome device.

## 10. Milestones

1. **M1 Engine:** rules, scoring, undo and hints, with tests.
2. **M2 Playable UI:** rendering, layout, drag and tap, deal, a basic win screen.
3. **M3 Windows 7 polish:** chrome, card art, animations, fireworks, sounds.
4. **M4 Meta features:** statistics, options, appearance, auto-save.
5. **M5 Mobile hardening and accessibility,** plus the optional PWA.

## 11. Open questions

1. Is tap-to-move on by default (proposed: yes), and is two-tap select also needed?
2. Should a hint cost points? (Proposed: no, as in Windows 7.)
3. Seeded and shareable game numbers: in v1, or later?
4. Hosting target and domain?
5. Is TypeScript + Vite with no framework acceptable, or do you prefer React or something else?
