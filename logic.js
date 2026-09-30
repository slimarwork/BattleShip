'use strict';
/* Игровая логика. Ничего не знает про интерфейс.
   shots: 0 — не стреляли, 1 — мимо, 2 — ранен, 3 — потоплен. */

const SIZE = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
const LETTERS = 'АБВГДЕЖЗИК'.split('');

const rnd = n => Math.floor(Math.random() * n);
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const grid = v => Array.from({ length: SIZE }, () => Array(SIZE).fill(v));
const newBoard = () => ({ ids: grid(-1), shots: grid(0), ships: [] });

function shipCells(r, c, len, horiz) {
  return Array.from({ length: len }, (_, i) => (horiz ? [r, c + i] : [r + i, c]));
}

// Клетка и все 8 соседей должны быть свободны: корабли не касаются.
function canPlace(b, r, c, len, horiz) {
  return shipCells(r, c, len, horiz).every(([y, x]) => {
    if (!inside(y, x)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = y + dy, nx = x + dx;
        if (inside(ny, nx) && b.ids[ny][nx] !== -1) return false;
      }
    }
    return true;
  });
}

function place(b, r, c, len, horiz) {
  const cells = shipCells(r, c, len, horiz);
  const id = b.ships.length;
  cells.forEach(([y, x]) => (b.ids[y][x] = id));
  b.ships.push({ cells, hits: 0 });
}

function randomFleet() {
  for (;;) {
    const b = newBoard();
    let ok = true;
    for (const len of FLEET) {
      let done = false;
      for (let t = 0; t < 200 && !done; t++) {
        const horiz = Math.random() < 0.5;
        const r = rnd(SIZE), c = rnd(SIZE);
        if (canPlace(b, r, c, len, horiz)) { place(b, r, c, len, horiz); done = true; }
      }
      if (!done) { ok = false; break; }
    }
    if (ok) return b;
  }
}

// Возвращает { result: 'repeat' | 'miss' | 'hit' | 'sunk' }
function shoot(b, r, c) {
  if (b.shots[r][c] !== 0) return { result: 'repeat' };
  const id = b.ids[r][c];
  if (id === -1) { b.shots[r][c] = 1; return { result: 'miss' }; }
  const ship = b.ships[id];
  ship.hits++;
  b.shots[r][c] = 2;
  if (ship.hits < ship.cells.length) return { result: 'hit' };
  // Потоплен: помечаем корабль и все клетки вокруг него как «мимо».
  ship.cells.forEach(([y, x]) => {
    b.shots[y][x] = 3;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = y + dy, nx = x + dx;
        if (inside(ny, nx) && b.shots[ny][nx] === 0) b.shots[ny][nx] = 1;
      }
    }
  });
  return { result: 'sunk' };
}

const alive = b => b.ships.filter(s => s.hits < s.cells.length).length;
const allSunk = b => alive(b) === 0;

// Бот видит только b.shots (то, что известно стреляющему), но не b.ids.
function botPick(b) {
  const S = b.shots, hits = [], free = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (S[r][c] === 2) hits.push([r, c]);
      else if (S[r][c] === 0) free.push([r, c]);
    }
  }
  const open = (r, c) => inside(r, c) && S[r][c] === 0;
  if (hits.length) {
    let dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (hits.length > 1) { // направление корабля уже видно — добиваем вдоль него
      dirs = hits.every(([r]) => r === hits[0][0]) ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    }
    const cand = [];
    hits.forEach(([r, c]) => dirs.forEach(([dy, dx]) => {
      if (open(r + dy, c + dx)) cand.push([r + dy, c + dx]);
    }));
    if (cand.length) return cand[rnd(cand.length)];
  }
  // Поиск «в шахматном порядке»: любой корабль длиннее 1 клетки заденет такую клетку.
  const parity = free.filter(([r, c]) => (r + c) % 2 === 0);
  const pool = parity.length ? parity : free;
  return pool[rnd(pool.length)];
}
