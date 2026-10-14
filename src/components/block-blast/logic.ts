export const SIZE = 8;
export const TRAY_SLOTS = 3;
/** A combo survives this many placements in a row without a clear. */
export const COMBO_GRACE = 3;
const PERFECT_BONUS = 300;

export type Cell = number | null;
export type Point = readonly [row: number, col: number];

export type Shape = {
  key: string;
  cells: Point[];
  rows: number;
  cols: number;
  weight: number;
};

export type Piece = {
  uid: number;
  shape: Shape;
  color: number;
};

export type Game = {
  board: Cell[];
  tray: (Piece | null)[];
  score: number;
  best: number;
  /** Best score when this run started — used to detect a new record. */
  prevBest: number;
  combo: number;
  maxCombo: number;
  sinceClear: number;
  lines: number;
  moves: number;
  over: boolean;
};

export type MoveResult = {
  game: Game;
  placed: number[];
  blasted: { index: number; color: number }[];
  rows: number[];
  cols: number[];
  lines: number;
  points: number;
  clearPoints: number;
  combo: number;
  perfect: boolean;
};

export const PALETTE = [
  { c: "#ff4d6d", l: "#ff9aae", d: "#c9184a" }, // red
  { c: "#ff9f1c", l: "#ffcf7d", d: "#e05a00" }, // orange
  { c: "#ffd60a", l: "#fff38f", d: "#e09b00" }, // yellow
  { c: "#2ee66b", l: "#9dffbc", d: "#0f9a45" }, // green
  { c: "#22d3ee", l: "#a0f3ff", d: "#0786b0" }, // cyan
  { c: "#4d7cff", l: "#a3bcff", d: "#2541d1" }, // blue
  { c: "#a855f7", l: "#d6adff", d: "#6d1fc4" }, // purple
  { c: "#ff5fd2", l: "#ffb0ec", d: "#cf1997" }, // pink
] as const;

// `weight` is the relative frequency of the base shape; it is split evenly
// across the rotations (and mirror images) generated from it.
const BASE_SHAPES: { art: string[]; weight: number; mirror?: boolean }[] = [
  { art: ["#"], weight: 2 },
  { art: ["##"], weight: 4 },
  { art: ["###"], weight: 5 },
  { art: ["####"], weight: 4 },
  { art: ["#####"], weight: 2.5 },
  { art: ["##", "##"], weight: 5 },
  { art: ["###", "###"], weight: 3 },
  { art: ["###", "###", "###"], weight: 2 },
  { art: ["#.", "##"], weight: 5 },
  { art: ["#.", "#.", "##"], weight: 5, mirror: true },
  { art: ["#..", "#..", "###"], weight: 3 },
  { art: ["###", ".#."], weight: 4 },
  { art: [".##", "##."], weight: 3, mirror: true },
];

function normalize(points: Point[]): Point[] {
  const minR = Math.min(...points.map(([r]) => r));
  const minC = Math.min(...points.map(([, c]) => c));
  return points
    .map(([r, c]) => [r - minR + 0, c - minC + 0] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const rotate = (points: Point[]) => normalize(points.map(([r, c]) => [c, -r] as const));
const mirror = (points: Point[]) => normalize(points.map(([r, c]) => [r, -c] as const));
const keyOf = (points: Point[]) => points.map(([r, c]) => `${r}${c}`).join(".");

function parse(art: string[]): Point[] {
  return art.flatMap((line, r) =>
    [...line].flatMap((ch, c) => (ch === "#" ? [[r, c] as const] : [])),
  );
}

function buildShapes(): Shape[] {
  const byKey = new Map<string, Shape>();
  for (const base of BASE_SHAPES) {
    const seed = normalize(parse(base.art));
    const variants = new Map<string, Point[]>();
    for (const start of base.mirror ? [seed, mirror(seed)] : [seed]) {
      let current = start;
      for (let i = 0; i < 4; i += 1) {
        variants.set(keyOf(current), current);
        current = rotate(current);
      }
    }
    for (const [key, cells] of variants) {
      byKey.set(key, {
        key,
        cells,
        rows: Math.max(...cells.map(([r]) => r)) + 1,
        cols: Math.max(...cells.map(([, c]) => c)) + 1,
        weight: base.weight / variants.size,
      });
    }
  }
  return [...byKey.values()];
}

export const SHAPES = buildShapes();
const SHAPE_BY_KEY = new Map(SHAPES.map((shape) => [shape.key, shape]));
const SMALLEST_FIRST = [...SHAPES].sort((a, b) => a.cells.length - b.cells.length);
const TOTAL_WEIGHT = SHAPES.reduce((sum, shape) => sum + shape.weight, 0);

export const emptyBoard = (): Cell[] => Array.from({ length: SIZE * SIZE }, () => null);

export function canPlace(board: Cell[], shape: Shape, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row + shape.rows > SIZE || col + shape.cols > SIZE) return false;
  return shape.cells.every(([r, c]) => board[(row + r) * SIZE + col + c] === null);
}

export function fitsAnywhere(board: Cell[], shape: Shape): boolean {
  for (let row = 0; row + shape.rows <= SIZE; row += 1) {
    for (let col = 0; col + shape.cols <= SIZE; col += 1) {
      if (canPlace(board, shape, row, col)) return true;
    }
  }
  return false;
}

export function cellsAt(shape: Shape, row: number, col: number): number[] {
  return shape.cells.map(([r, c]) => (row + r) * SIZE + col + c);
}

export function fullLines(board: Cell[]): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < SIZE; i += 1) {
    let rowFull = true;
    let colFull = true;
    for (let j = 0; j < SIZE; j += 1) {
      if (board[i * SIZE + j] === null) rowFull = false;
      if (board[j * SIZE + i] === null) colFull = false;
    }
    if (rowFull) rows.push(i);
    if (colFull) cols.push(i);
  }
  return { rows, cols };
}

export function lineCells(rows: number[], cols: number[]): number[] {
  const cells = new Set<number>();
  for (const row of rows) for (let c = 0; c < SIZE; c += 1) cells.add(row * SIZE + c);
  for (const col of cols) for (let r = 0; r < SIZE; r += 1) cells.add(r * SIZE + col);
  return [...cells];
}

export function clearPoints(lines: number, combo: number): number {
  if (lines === 0) return 0;
  const base = 10 * lines * (lines + 1); // 20, 60, 120, 200, ...
  return Math.round(base * (1 + (combo - 1) * 0.5));
}

function pickShape(rand: () => number): Shape {
  let ticket = rand() * TOTAL_WEIGHT;
  for (const shape of SHAPES) {
    ticket -= shape.weight;
    if (ticket <= 0) return shape;
  }
  return SHAPES[SHAPES.length - 1];
}

function pickColors(count: number, rand: () => number): number[] {
  const pool = PALETTE.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/**
 * Deals a fresh set of pieces. Early on it tries hard to deal a set where
 * every piece fits somewhere; later it only guarantees that one does.
 */
export function dealTray(board: Cell[], score: number, rand = Math.random): Piece[] {
  const strictAttempts = score < 1500 ? 14 : score < 5000 ? 6 : 2;
  let shapes: Shape[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    shapes = Array.from({ length: TRAY_SLOTS }, () => pickShape(rand));
    const fitting = shapes.filter((shape) => fitsAnywhere(board, shape)).length;
    if (fitting === TRAY_SLOTS || (attempt >= strictAttempts && fitting > 0)) break;
  }
  if (!shapes.some((shape) => fitsAnywhere(board, shape))) {
    const rescue = SMALLEST_FIRST.find((shape) => fitsAnywhere(board, shape));
    if (rescue) shapes[0] = rescue;
  }
  const colors = pickColors(TRAY_SLOTS, rand);
  return shapes.map((shape, i) => ({
    uid: Math.floor(rand() * 2 ** 31),
    shape,
    color: colors[i],
  }));
}

export function newGame(best: number): Game {
  const board = emptyBoard();
  return {
    board,
    tray: dealTray(board, 0),
    score: 0,
    best,
    prevBest: best,
    combo: 0,
    maxCombo: 0,
    sinceClear: 0,
    lines: 0,
    moves: 0,
    over: false,
  };
}

export function applyMove(game: Game, slot: number, row: number, col: number): MoveResult | null {
  const piece = game.tray[slot];
  if (game.over || !piece || !canPlace(game.board, piece.shape, row, col)) return null;

  const placed = cellsAt(piece.shape, row, col);
  const filled = game.board.slice();
  for (const index of placed) filled[index] = piece.color;

  const { rows, cols } = fullLines(filled);
  const lines = rows.length + cols.length;
  const blasted = lineCells(rows, cols).map((index) => ({ index, color: filled[index] as number }));
  const board = filled.slice();
  for (const { index } of blasted) board[index] = null;

  let combo = game.combo;
  let sinceClear = game.sinceClear;
  if (lines > 0) {
    combo += 1;
    sinceClear = 0;
  } else {
    sinceClear += 1;
    if (sinceClear >= COMBO_GRACE) combo = 0;
  }

  const perfect = lines > 0 && board.every((cell) => cell === null);
  const gained = clearPoints(lines, combo);
  const points = placed.length + gained + (perfect ? PERFECT_BONUS : 0);
  const score = game.score + points;

  let tray = game.tray.map((p, i) => (i === slot ? null : p));
  if (tray.every((p) => p === null)) tray = dealTray(board, score);
  const over = !tray.some((p) => p !== null && fitsAnywhere(board, p.shape));

  return {
    game: {
      ...game,
      board,
      tray,
      score,
      best: Math.max(game.best, score),
      combo,
      maxCombo: Math.max(game.maxCombo, combo),
      sinceClear,
      lines: game.lines + lines,
      moves: game.moves + 1,
      over,
    },
    placed,
    blasted,
    rows,
    cols,
    lines,
    points,
    clearPoints: gained + (perfect ? PERFECT_BONUS : 0),
    combo,
    perfect,
  };
}

/** Rebuilds a saved game, resolving shapes by key. Returns null if anything looks off. */
export function reviveGame(raw: unknown): Game | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<Game> & { tray?: unknown[] };
  const isColor = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value < PALETTE.length;
  if (!Array.isArray(data.board) || data.board.length !== SIZE * SIZE) return null;
  if (!data.board.every((cell) => cell === null || isColor(cell))) return null;
  if (!Array.isArray(data.tray) || data.tray.length !== TRAY_SLOTS) return null;

  const tray: (Piece | null)[] = [];
  for (const item of data.tray) {
    if (item === null) {
      tray.push(null);
      continue;
    }
    const piece = item as { uid?: unknown; shape?: { key?: unknown }; color?: unknown };
    const shape = SHAPE_BY_KEY.get(String(piece.shape?.key));
    if (!shape || !isColor(piece.color)) return null;
    tray.push({ uid: Number(piece.uid) || 0, shape, color: piece.color as number });
  }
  if (tray.every((p) => p === null)) return null;

  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const board = data.board as Cell[];
  return {
    board,
    tray,
    score: num(data.score),
    best: num(data.best),
    prevBest: num(data.prevBest),
    combo: num(data.combo),
    maxCombo: num(data.maxCombo),
    sinceClear: num(data.sinceClear),
    lines: num(data.lines),
    moves: num(data.moves),
    over: !tray.some((p) => p !== null && fitsAnywhere(board, p.shape)),
  };
}
