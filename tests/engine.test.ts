import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, decodeBoard, encodeBoard } from '../src/engine/game';
import { cardDefs, rankOf, suitOf } from '../src/engine/cards';

const R1 = { suits: 1 as const, strictDeal: true };

function allIds(g: Game) {
  const b = g.board;
  return [...b.tableau.flat(), ...b.stock, ...b.foundations.flat()].sort((a, c) => a - c);
}

/** Build a game whose board is set by hand (a partial deck; all cards face up unless changed). */
function withBoard(rules: { suits: 1 | 2 | 4; strictDeal: boolean }, tableau: number[][], stock: number[] = []) {
  const g = Game.create(rules, 1);
  const faceUp = new Array(104).fill(true);
  g.board = { tableau: tableau.map((c) => c.slice()), stock: stock.slice(), foundations: [], faceUp };
  return g;
}

test('deck composition per suit count', () => {
  for (const suits of [1, 2, 4] as const) {
    const defs = cardDefs(suits);
    assert.equal(defs.length, 104);
    const counts = new Map<string, number>();
    for (const d of defs) counts.set(`${d.suit}-${d.rank}`, (counts.get(`${d.suit}-${d.rank}`) ?? 0) + 1);
    assert.equal(counts.size, suits * 13);
    for (const v of counts.values()) assert.equal(v, 8 / suits);
  }
});

test('initial deal: 6,6,6,6,5,5,5,5,5,5 and 50 in stock, tops face up', () => {
  const g = Game.create(R1, 42);
  assert.deepEqual(g.board.tableau.map((c) => c.length), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
  assert.equal(g.board.stock.length, 50);
  assert.equal(g.dealsLeft, 5);
  for (const c of g.board.tableau) {
    c.forEach((id, i) => assert.equal(g.board.faceUp[id], i === c.length - 1));
  }
  assert.deepEqual(allIds(g), Array.from({ length: 104 }, (_, i) => i));
  assert.equal(g.score, 500);
});

test('same seed gives the same deal', () => {
  assert.equal(encodeBoard(Game.create(R1, 7).board), encodeBoard(Game.create(R1, 7).board));
  assert.notEqual(encodeBoard(Game.create(R1, 7).board), encodeBoard(Game.create(R1, 8).board));
});

test('move onto rank+1 of any suit; runs must be same suit', () => {
  // 4-suit: id 9 = 10 of spades (set 0), id 22 = 10 of hearts (set 1), id 23 = J of hearts, id 8 = 9 spades
  const g = withBoard({ suits: 4, strictDeal: true }, [[23], [9, 8], [22], [], [], [], [], [], [], []]);
  assert.equal(suitOf(23, 4), 1);
  assert.equal(rankOf(23), 11);
  assert.ok(g.isMovableRun(1, 0)); // 10S-9S suited run
  assert.ok(g.canMove(1, 0, 0)); // 10S onto JH (any suit)
  assert.ok(g.canMove(2, 0, 0));
  assert.ok(!g.canMove(1, 1, 0)); // 9 onto J: no
  const r = g.move(1, 0, 0)!;
  assert.deepEqual(g.board.tableau[0], [23, 9, 8]);
  assert.deepEqual(r.moved, [9, 8]);
  assert.ok(!g.isMovableRun(0, 0)); // JH-10S mixed suits
  assert.ok(g.isMovableRun(0, 1));
  assert.equal(g.moves, 1);
  assert.equal(g.score, 499);
});

test('cannot pick up face-down cards; uncovering flips', () => {
  const g = withBoard(R1, [[5, 12], [], [], [], [], [], [], [], [], []]);
  g.board.faceUp[5] = false;
  assert.ok(!g.isMovableRun(0, 0));
  const r = g.move(0, 1, 1)!;
  assert.deepEqual(r.flipped, [5]);
  assert.ok(g.board.faceUp[5]);
});

test('completed K..A run is removed and scores +100', () => {
  // 1 suit: ids 0..12 are A..K spades.
  const king2queen = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const g = withBoard(R1, [[13, ...king2queen], [0], [], [], [], [], [], [], [], []]);
  g.board.faceUp[13] = false;
  const r = g.move(1, 0, 0)!;
  assert.deepEqual(r.completed, [0]);
  assert.equal(g.board.foundations.length, 1);
  assert.deepEqual(g.board.foundations[0], [...king2queen, 0]);
  assert.deepEqual(g.board.tableau[0], [13]);
  assert.ok(g.board.faceUp[13]);
  assert.equal(g.score, 500 - 1 + 100);
  // Undo restores the run and reverses the bonus; the undo itself costs a move.
  g.undo();
  assert.equal(g.board.foundations.length, 0);
  assert.equal(g.board.tableau[0].length, 13);
  assert.equal(g.score, 498);
});

test('deal restriction rule', () => {
  const tableau = [[1], [], [3], [4], [5], [6], [7], [8], [9], [10]];
  const stock = Array.from({ length: 10 }, (_, i) => 20 + i);
  const strict = withBoard(R1, tableau, stock);
  assert.equal(strict.checkDeal(), 'empty-column');
  assert.equal(strict.deal(), null);
  const loose = withBoard({ suits: 1, strictDeal: false }, tableau, stock);
  assert.equal(loose.checkDeal(), 'ok');
  const r = loose.deal()!;
  assert.equal(r.moved.length, 10);
  assert.equal(loose.board.tableau[1].length, 1);
  assert.equal(loose.board.stock.length, 0);
  assert.equal(loose.checkDeal(), 'empty-stock');
});

test('deal flips cards face up and can be undone and redone', () => {
  const g = Game.create(R1, 3);
  const before = encodeBoard(g.board);
  g.deal();
  assert.equal(g.board.stock.length, 40);
  for (const c of g.board.tableau) assert.ok(g.board.faceUp[c[c.length - 1]]);
  const after = encodeBoard(g.board);
  g.undo();
  assert.equal(encodeBoard(g.board), before);
  g.redo();
  assert.equal(encodeBoard(g.board), after);
  assert.equal(g.moves, 3);
  assert.ok(!g.canRedo);
});

test('a new move clears redo', () => {
  const g = Game.create(R1, 3);
  g.deal();
  g.undo();
  assert.ok(g.canRedo);
  g.deal();
  assert.ok(!g.canRedo);
});

test('encode/decode round trip and save/load', () => {
  const g = Game.create({ suits: 4, strictDeal: false }, 99);
  g.deal();
  const m = g.legalMoves()[0];
  if (m) g.move(m.from, m.index, m.to);
  assert.equal(encodeBoard(decodeBoard(encodeBoard(g.board))), encodeBoard(g.board));
  const copy = Game.deserialize(JSON.parse(JSON.stringify(g.serialize())));
  assert.equal(encodeBoard(copy.board), encodeBoard(g.board));
  assert.equal(copy.moves, g.moves);
  assert.deepEqual(copy.rules, g.rules);
  copy.undo();
  g.undo();
  assert.equal(encodeBoard(copy.board), encodeBoard(g.board));
});

test('corrupt saves are rejected', () => {
  const s = Game.create(R1, 1).serialize();
  s.board = s.board.slice(2);
  assert.throws(() => Game.deserialize(s));
});

test('hints prefer same-suit builds and skip pointless moves', () => {
  // 2 suits: ids 0..12 spades, 13..25 hearts.
  // col0: 9S(8) ; col1: 10H(22) ; col2: 10S(9) ; col3: JS(10) with 10H? no.
  const g = withBoard({ suits: 2, strictDeal: true }, [[8], [22], [9], [], [], [], [], [], [], []]);
  const h = g.hints();
  assert.deepEqual(h[0], { from: 0, index: 0, to: 2 }); // 9S onto 10S beats 10H
  // Whole single-card column to an empty column is pointless.
  assert.ok(!h.some((m) => g.board.tableau[m.to].length === 0 && m.index === 0));
});

test('stuck detection', () => {
  // Only aces, no empty columns, no stock: nothing can move.
  const g = withBoard(R1, [[0], [13], [26], [39], [52], [65], [78], [91], [10], [23]]);
  assert.ok(g.isStuck());
});

test('play many random games without breaking invariants', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = Game.create({ suits: ([1, 2, 4] as const)[seed % 3], strictDeal: seed % 2 === 0 }, seed);
    for (let step = 0; step < 300; step++) {
      const h = g.hints();
      if (h.length && step % 7 !== 6) {
        const m = h[step % Math.min(3, h.length)];
        assert.ok(g.move(m.from, m.index, m.to));
      } else if (g.checkDeal() === 'ok') g.deal();
      else if (step % 5 === 0 && g.canUndo) g.undo();
      else break;
      assert.equal(allIds(g).length, 104);
      assert.equal(new Set(allIds(g)).size, 104);
      for (const c of g.board.tableau) if (c.length) assert.ok(g.board.faceUp[c[c.length - 1]]);
    }
  }
});
