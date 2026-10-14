"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  COMBO_GRACE,
  PALETTE,
  SIZE,
  applyMove,
  canPlace,
  cellsAt,
  fitsAnywhere,
  fullLines,
  lineCells,
  newGame,
  reviveGame,
  type Cell,
  type Game,
  type Piece,
  type Shape,
} from "./logic";
import { sfx } from "./sound";
import { CrownIcon, FlameIcon, PauseIcon, PlayIcon, RestartIcon, SoundIcon } from "./icons";

const STORAGE = {
  game: "blockblast:game:v1",
  best: "blockblast:best:v1",
  muted: "blockblast:muted:v1",
};

const PRAISE = ["", "Good!", "Great!", "Excellent!", "Amazing!", "Unbelievable!", "Legendary!"];
const ARROWS: Record<string, readonly [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

type Anchor = { row: number; col: number };
type Drag = { slot: number; x: number; y: number; cell: number; gap: number };
type Particle = { dx: number; dy: number; rot: number; size: number };
type Blast = {
  id: number;
  cells: { index: number; color: number; delay: number; particles: Particle[] }[];
};
type Toast = { id: number; title: string; sub: string; top: number; tone: number };
type ScorePop = { id: number; value: number };
type Preview = { valid: boolean; color: number; cells: Set<number>; clears: Set<number> };
type Menu = "pause" | "restart" | null;

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const later = (fn: () => void, ms: number) => window.setTimeout(fn, ms);

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or storage disabled — the game still works, it just won't resume.
  }
}

function loadGame(): Game {
  let saved: Game | null = null;
  try {
    saved = reviveGame(JSON.parse(readStorage(STORAGE.game) ?? "null"));
  } catch {
    saved = null;
  }
  const best = Math.max(Number(readStorage(STORAGE.best)) || 0, saved?.best ?? 0);
  return saved && !saved.over ? { ...saved, best } : newGame(best);
}

function colorVars(color: number): CSSProperties {
  const { c, l, d } = PALETTE[color];
  return { "--c": c, "--l": l, "--d": d } as CSSProperties;
}

function clampAnchor(anchor: Anchor, shape: Shape): Anchor {
  return {
    row: clamp(anchor.row, 0, SIZE - shape.rows),
    col: clamp(anchor.col, 0, SIZE - shape.cols),
  };
}

/** Closest legal spot to `from`, so keyboard/tap selection starts somewhere useful. */
function nearestFit(board: Cell[], shape: Shape, from: Anchor): Anchor {
  let best: Anchor | null = null;
  let bestDistance = Infinity;
  for (let row = 0; row + shape.rows <= SIZE; row += 1) {
    for (let col = 0; col + shape.cols <= SIZE; col += 1) {
      if (!canPlace(board, shape, row, col)) continue;
      const distance = (row - from.row) ** 2 + (col - from.col) ** 2;
      if (distance < bestDistance) {
        best = { row, col };
        bestDistance = distance;
      }
    }
  }
  return best ?? clampAnchor(from, shape);
}

/** Snaps a dragged piece's top-left corner (relative to the grid) to a legal cell. */
function snap(x: number, y: number, pitch: number, shape: Shape, board: Cell[]): Anchor | null {
  const row = Math.round(y / pitch);
  const col = Math.round(x / pitch);
  if (row < -1 || col < -1 || row > SIZE - shape.rows + 1 || col > SIZE - shape.cols + 1) return null;
  const anchor = clampAnchor({ row, col }, shape);
  return canPlace(board, shape, anchor.row, anchor.col) ? anchor : null;
}

function computePreview(board: Cell[], piece: Piece | null, anchor: Anchor | null): Preview | null {
  if (!piece || !anchor) return null;
  const cells = cellsAt(piece.shape, anchor.row, anchor.col);
  const valid = canPlace(board, piece.shape, anchor.row, anchor.col);
  let clears: number[] = [];
  if (valid) {
    const next = board.slice();
    for (const index of cells) next[index] = piece.color;
    const { rows, cols } = fullLines(next);
    clears = lineCells(rows, cols);
  }
  return { valid, color: piece.color, cells: new Set(cells), clears: new Set(clears) };
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 0.9 + Math.random() * 1.8;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 0.7,
      rot: (Math.random() - 0.5) * 600,
      size: 0.2 + Math.random() * 0.22,
    };
  });
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const subscribeNothing = () => () => {};

export default function BlockBlast() {
  // The game deals random pieces and reads localStorage, so it only renders in the browser.
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

  return (
    <div className="bb-root">
      <Backdrop />
      {hydrated ? <GameScreen /> : <Splash />}
    </div>
  );
}

function GameScreen() {
  const [game, setGame] = useState(loadGame);
  const [muted, setMuted] = useState(() => readStorage(STORAGE.muted) === "1");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Anchor | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Anchor>({ row: 3, col: 3 });
  const [placed, setPlaced] = useState<number[]>([]);
  const [blasts, setBlasts] = useState<Blast[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pops, setPops] = useState<ScorePop[]>([]);
  const [menu, setMenu] = useState<Menu>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const floatPos = useRef({ left: 0, top: 0 });
  const fxSeq = useRef(0);
  const stopDrag = useRef<(() => void) | null>(null);

  useEffect(() => {
    writeStorage(STORAGE.game, JSON.stringify(game));
    writeStorage(STORAGE.best, String(game.best));
  }, [game]);

  useEffect(() => {
    sfx.setMuted(muted);
    writeStorage(STORAGE.muted, muted ? "1" : "0");
  }, [muted]);

  useEffect(() => () => stopDrag.current?.(), []);

  // Moves that arrive before the floating piece mounts still need to show up.
  useLayoutEffect(() => {
    const { left, top } = floatPos.current;
    if (drag && floatRef.current) floatRef.current.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }, [drag]);

  const activeSlot = drag ? drag.slot : selected;
  const activePiece = activeSlot === null ? null : game.tray[activeSlot];
  const preview = computePreview(game.board, activePiece, drag ? hover : selected !== null ? cursor : null);
  const justPlaced = new Set(placed);
  const fits = game.tray.map((piece) => piece !== null && fitsAnywhere(game.board, piece.shape));
  const comboLeft = game.combo > 0 ? COMBO_GRACE - game.sinceClear : 0;
  const dragPiece = drag ? game.tray[drag.slot] : null;
  const newRecord = game.score > game.prevBest;

  function measure() {
    const grid = gridRef.current!;
    const rect = grid.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    return { rect, gap, pitch: (rect.width + gap) / SIZE };
  }

  /** Board cell under a pointer, with the piece centred on it. */
  function pointToAnchor(x: number, y: number, shape: Shape): Anchor | null {
    const { rect, pitch } = measure();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return clampAnchor(
      {
        row: Math.round((y - rect.top) / pitch - shape.rows / 2),
        col: Math.round((x - rect.left) / pitch - shape.cols / 2),
      },
      shape,
    );
  }

  function shake(lines: number) {
    const board = boardRef.current;
    if (!board || prefersReducedMotion()) return;
    const a = Math.min(3 + lines * 2.5, 12);
    board.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: `translate(${-a}px, ${a * 0.4}px) rotate(-0.4deg)` },
        { transform: `translate(${a * 0.8}px, ${-a * 0.5}px) rotate(0.3deg)` },
        { transform: `translate(${-a * 0.5}px, ${a * 0.3}px)` },
        { transform: `translate(${a * 0.25}px, 0)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: 380 + lines * 40, easing: "cubic-bezier(.36,.07,.19,.97)" },
    );
  }

  function commit(slot: number, row: number, col: number): boolean {
    const result = applyMove(game, slot, row, col);
    if (!result) return false;

    const id = ++fxSeq.current;
    setGame(result.game);
    setPlaced(result.placed);
    setSelected(null);
    sfx.place();
    setPops((list) => [...list, { id, value: result.points }]);
    later(() => setPops((list) => list.filter((pop) => pop.id !== id)), 950);

    if (result.lines > 0) {
      const centerRow = result.placed.reduce((sum, i) => sum + Math.floor(i / SIZE), 0) / result.placed.length;
      const centerCol = result.placed.reduce((sum, i) => sum + (i % SIZE), 0) / result.placed.length;
      const cells = result.blasted.map(({ index, color }) => {
        const r = Math.floor(index / SIZE);
        const c = index % SIZE;
        const alongRow = result.rows.includes(r) ? Math.abs(c - centerCol) : Infinity;
        const alongCol = result.cols.includes(c) ? Math.abs(r - centerRow) : Infinity;
        return {
          index,
          color,
          delay: Math.round(Math.min(alongRow, alongCol) * 45),
          particles: makeParticles(result.lines > 2 ? 4 : 3),
        };
      });
      setBlasts((list) => [...list, { id, cells }]);
      later(() => setBlasts((list) => list.filter((blast) => blast.id !== id)), 1300);

      const title = result.perfect
        ? "Perfect!"
        : result.lines === 1 && result.combo >= 2
          ? `Combo ${result.combo}`
          : PRAISE[Math.min(result.lines, PRAISE.length - 1)];
      const sub = [result.combo >= 2 && result.lines > 1 ? `Combo ×${result.combo}` : "", `+${result.clearPoints}`]
        .filter(Boolean)
        .join("  ·  ");
      const avgRow = result.blasted.reduce((sum, b) => sum + Math.floor(b.index / SIZE), 0) / result.blasted.length;
      const toast: Toast = {
        id,
        title,
        sub,
        top: clamp(((avgRow + 0.5) / SIZE) * 100, 20, 80),
        tone: result.perfect ? 3 : Math.min(result.lines - 1 + (result.combo >= 3 ? 1 : 0), 3),
      };
      setToasts((list) => [...list, toast]);
      later(() => setToasts((list) => list.filter((t) => t.id !== id)), 1500);

      sfx.clear(result.lines, result.combo);
      if (result.perfect) sfx.perfect();
      shake(result.lines);
      navigator.vibrate?.(result.lines > 1 ? [18, 40, 28] : 16);
    }

    if (result.game.over) later(() => sfx.gameOver(), 700);
    return true;
  }

  function toggleSelect(slot: number) {
    const piece = game.tray[slot];
    if (!piece || game.over) return;
    if (selected === slot) {
      setSelected(null);
      return;
    }
    setSelected(slot);
    setCursor(nearestFit(game.board, piece.shape, cursor));
    sfx.select();
  }

  function restart() {
    stopDrag.current?.();
    setGame(newGame(game.best));
    setDrag(null);
    setHover(null);
    setSelected(null);
    setPlaced([]);
    setBlasts([]);
    setToasts([]);
    setMenu(null);
    sfx.start();
  }

  function onSlotPointerDown(event: ReactPointerEvent<HTMLDivElement>, slot: number) {
    const piece = game.tray[slot];
    if (!piece || game.over || menu || stopDrag.current || !gridRef.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();

    const { gap, pitch } = measure();
    const { shape } = piece;
    const mouse = event.pointerType === "mouse";
    const width = shape.cols * pitch - gap;
    const height = shape.rows * pitch - gap;
    // On touch the piece floats above the finger so it isn't hidden under it.
    const topLeft = (x: number, y: number) => ({
      left: x - width / 2,
      top: mouse ? y - height / 2 : y - height - pitch * 1.1,
    });

    const { pointerId, clientX: startX, clientY: startY } = event;
    const board = game.board;
    const wasSelected = selected === slot;
    let moved = false;
    let target: Anchor | null = null;

    const start = topLeft(startX, startY);
    floatPos.current = start;
    setDrag({ slot, x: start.left, y: start.top, cell: pitch - gap, gap });
    setSelected(null);
    sfx.pick();

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > 8) moved = true;
      const { left, top } = topLeft(e.clientX, e.clientY);
      floatPos.current = { left, top };
      if (floatRef.current) floatRef.current.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = snap(left - rect.left, top - rect.top, pitch, shape, board);
      if (next?.row !== target?.row || next?.col !== target?.col) {
        target = next;
        setHover(next);
      }
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      cleanup();
      setDrag(null);
      setHover(null);
      if (e.type === "pointerup" && moved && target) {
        commit(slot, target.row, target.col);
      } else if (e.type === "pointerup" && !moved) {
        // A tap selects the piece for tap-to-place / keyboard play.
        if (wasSelected) return;
        setSelected(slot);
        setCursor(nearestFit(board, shape, cursor));
        sfx.select();
      } else {
        sfx.drop();
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      stopDrag.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    stopDrag.current = cleanup;
  }

  function onBoardPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (selected === null || drag || event.pointerType !== "mouse") return;
    const piece = game.tray[selected];
    if (!piece) return;
    const next = pointToAnchor(event.clientX, event.clientY, piece.shape);
    if (next && (next.row !== cursor.row || next.col !== cursor.col)) setCursor(next);
  }

  function onBoardClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (selected === null) return;
    const piece = game.tray[selected];
    if (!piece) return;
    const at = pointToAnchor(event.clientX, event.clientY, piece.shape);
    if (!at) return;
    if (!commit(selected, at.row, at.col)) {
      setCursor(at);
      sfx.invalid();
    }
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || drag) return;
    const { key } = event;
    const onControl = event.target instanceof Element && event.target.closest("button, a, input") !== null;
    const confirmKey = key === "Enter" || key === " ";

    if (menu) {
      if (key === "Escape") setMenu(null);
      return;
    }
    if (key === "m" || key === "M") {
      setMuted((value) => !value);
      return;
    }
    if (game.over) {
      if (confirmKey && !onControl) {
        event.preventDefault();
        restart();
      }
      return;
    }
    if (key === "p" || key === "P") {
      setMenu("pause");
      return;
    }
    if (key === "1" || key === "2" || key === "3") {
      event.preventDefault();
      toggleSelect(Number(key) - 1);
      return;
    }

    const step = ARROWS[key];
    if (selected === null) {
      if (step || (confirmKey && !onControl)) {
        event.preventDefault();
        const slot = fits.findIndex(Boolean);
        toggleSelect(slot >= 0 ? slot : game.tray.findIndex((piece) => piece !== null));
      } else if (key === "Escape") {
        setMenu("pause");
      }
      return;
    }

    const piece = game.tray[selected];
    if (!piece) return;
    if (step) {
      event.preventDefault();
      setCursor((current) =>
        clampAnchor({ row: current.row + step[0], col: current.col + step[1] }, piece.shape),
      );
    } else if (confirmKey && !onControl) {
      event.preventDefault();
      if (!commit(selected, cursor.row, cursor.col)) sfx.invalid();
    } else if (key === "Escape") {
      setSelected(null);
    }
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const soundButton = (
    <IconButton label={muted ? "Turn sound on" : "Mute sound"} onClick={() => setMuted((value) => !value)}>
      <SoundIcon muted={muted} />
    </IconButton>
  );

  return (
    <>
      <main className="bb-stage">
        {/* Phone / tablet header */}
        <header className="bb-mobile-head">
          <div className="flex w-full items-center justify-between short:flex-col short:items-start short:gap-3">
            <BestChip best={game.best} />
            <div className="flex gap-2">
              {soundButton}
              <IconButton label="Pause" onClick={() => setMenu("pause")}>
                <PauseIcon />
              </IconButton>
            </div>
          </div>
          <div className="relative flex flex-col items-center short:items-start">
            <Counter value={game.score} className="bb-display bb-score-big" />
            <ScorePops pops={pops} />
            <ComboMeter combo={game.combo} left={comboLeft} />
          </div>
        </header>

        {/* Desktop: left panel */}
        <aside className="bb-side">
          <Logo />
          <Card>
            <Label>Score</Label>
            <div className="relative">
              <Counter value={game.score} className="bb-display block text-6xl leading-none" />
              <ScorePops pops={pops} />
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-b from-amber-300 to-orange-500 text-2xl text-white shadow-[0_4px_0_#9a3412]">
              <CrownIcon />
            </span>
            <div>
              <Label>Best</Label>
              <span className="bb-display text-3xl leading-none">{game.best.toLocaleString("en-US")}</span>
            </div>
          </Card>
          <Card>
            <Label>Combo</Label>
            <ComboMeter combo={game.combo} left={comboLeft} large />
            <p className="mt-2 text-xs leading-relaxed text-white/60">
              Clear again within {COMBO_GRACE} moves to keep the streak alive.
            </p>
          </Card>
        </aside>

        {/* Board + tray */}
        <section className="bb-play">
          <div ref={boardRef} className="bb-board" data-over={game.over || undefined}>
            <div
              ref={gridRef}
              className={cx("bb-grid", selected !== null && "cursor-pointer")}
              onPointerMove={onBoardPointerMove}
              onClick={onBoardClick}
            >
              {game.board.map((cell, index) => {
                const inPiece = preview?.cells.has(index) ?? false;
                if (preview?.clears.has(index)) {
                  return <div key={index} className="bb-block bb-charged" style={colorVars(preview.color)} />;
                }
                if (cell !== null) {
                  return (
                    <div
                      key={index}
                      className={cx("bb-block", justPlaced.has(index) && "bb-pop", inPiece && "bb-blocked")}
                      style={{ ...colorVars(cell), "--r": Math.floor(index / SIZE) } as CSSProperties}
                    />
                  );
                }
                if (preview && inPiece) {
                  return (
                    <div
                      key={index}
                      className={cx("bb-ghost", !preview.valid && "bb-ghost-bad")}
                      style={colorVars(preview.color)}
                    />
                  );
                }
                return <div key={index} className="bb-slot" />;
              })}
            </div>

            <div className="bb-grid bb-fx" aria-hidden>
              {blasts.flatMap((blast) =>
                blast.cells.map((cell) => (
                  <div
                    key={`${blast.id}-${cell.index}`}
                    className="relative"
                    style={{ gridRow: Math.floor(cell.index / SIZE) + 1, gridColumn: (cell.index % SIZE) + 1 }}
                  >
                    <div
                      className="bb-block bb-blast"
                      style={{ ...colorVars(cell.color), animationDelay: `${cell.delay}ms` }}
                    />
                    {cell.particles.map((p, i) => (
                      <span
                        key={i}
                        className="bb-particle"
                        style={
                          {
                            ...colorVars(cell.color),
                            "--dx": p.dx,
                            "--dy": p.dy,
                            "--rot": `${p.rot}deg`,
                            "--s": p.size,
                            animationDelay: `${cell.delay + 70}ms`,
                          } as CSSProperties
                        }
                      />
                    ))}
                  </div>
                )),
              )}
            </div>

            {toasts.map((toast) => (
              <div key={toast.id} className="bb-toast" data-tone={toast.tone} style={{ top: `${toast.top}%` }}>
                <div className="bb-toast-title">{toast.title}</div>
                <div className="bb-toast-sub">{toast.sub}</div>
              </div>
            ))}

            {game.over && <div className="bb-banner">No more space!</div>}
          </div>

          <div className="bb-tray">
            {game.tray.map((piece, slot) => (
              <div
                key={slot}
                role="button"
                aria-label={piece ? `Piece ${slot + 1}: ${piece.shape.cells.length} blocks` : `Slot ${slot + 1} empty`}
                className="bb-tray-slot"
                data-selected={selected === slot || undefined}
                data-empty={piece === null || undefined}
                onPointerDown={(event) => onSlotPointerDown(event, slot)}
              >
                {piece && (
                  <div
                    key={piece.uid}
                    className={cx(
                      "bb-tray-piece",
                      !fits[slot] && "bb-dead",
                      drag?.slot === slot && "bb-lifted",
                    )}
                    style={{ animationDelay: `${slot * 80}ms` }}
                  >
                    <PieceView piece={piece} cell="var(--cell)" gap="var(--tgap)" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Desktop: right panel */}
        <aside className="bb-side">
          <Card>
            <Label>This run</Label>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Stat label="Lines" value={game.lines} tone="text-cyan-300" />
              <Stat label="Moves" value={game.moves} tone="text-pink-300" />
              <Stat label="Max combo" value={game.maxCombo} tone="text-amber-300" />
            </div>
          </Card>
          <Card>
            <Label>How to play</Label>
            <ul className="mt-2 space-y-1.5 text-sm leading-snug text-white/80">
              <li>Drag a block onto the board.</li>
              <li>Fill a whole row or column to blast it.</li>
              <li>Clear several lines at once for big points.</li>
              <li>Game ends when no block fits.</li>
            </ul>
          </Card>
          <Card>
            <Label>Keyboard</Label>
            <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm text-white/80">
              <Kbd keys={["1", "2", "3"]} /> <dd>Pick a block</dd>
              <Kbd keys={["←", "↑", "→", "↓"]} /> <dd>Move it</dd>
              <Kbd keys={["Enter"]} /> <dd>Place</dd>
              <Kbd keys={["Esc"]} /> <dd>Cancel / pause</dd>
              <Kbd keys={["M"]} /> <dd>Sound</dd>
            </dl>
          </Card>
          <div className="flex gap-3">
            <button
              type="button"
              className="bb-btn bb-btn-primary flex-1"
              onClick={() => (game.moves > 0 ? setMenu("restart") : restart())}
            >
              <RestartIcon /> New game
            </button>
            {soundButton}
          </div>
        </aside>
      </main>

      {drag && dragPiece && (
        <div
          ref={floatRef}
          className="bb-float"
          style={{ transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`, "--cell": `${drag.cell}px` } as CSSProperties}
        >
          <div className="bb-float-inner">
            <PieceView piece={dragPiece} cell={`${drag.cell}px`} gap={`${drag.gap}px`} />
          </div>
        </div>
      )}

      {menu && (
        <Modal onClose={() => setMenu(null)}>
          {menu === "pause" ? (
            <>
              <h2 className="bb-display text-center text-5xl">Paused</h2>
              <div className="mt-6 flex flex-col gap-3">
                <button type="button" className="bb-btn bb-btn-primary" onClick={() => setMenu(null)} autoFocus>
                  <PlayIcon /> Resume
                </button>
                <button type="button" className="bb-btn" onClick={() => setMenu("restart")}>
                  <RestartIcon /> New game
                </button>
                <button type="button" className="bb-btn" onClick={() => setMuted((value) => !value)}>
                  <SoundIcon muted={muted} /> Sound {muted ? "off" : "on"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="bb-display text-center text-4xl">Start over?</h2>
              <p className="mt-2 text-center text-white/70">Your current score of {game.score.toLocaleString("en-US")} will be lost.</p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button type="button" className="bb-btn" onClick={() => setMenu(null)}>
                  Cancel
                </button>
                <button type="button" className="bb-btn bb-btn-primary" onClick={restart} autoFocus>
                  New game
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {game.over && (
        <Modal delayed>
          {newRecord && <div className="bb-ribbon">New best!</div>}
          <p className="text-center text-xs font-semibold uppercase tracking-[0.35em] text-white/60">Game over</p>
          <h2 className="bb-display mt-1 text-center text-4xl">No more space!</h2>
          <div className="mt-5 text-center">
            <Label>Score</Label>
            <div className="bb-display bb-gradient-text text-7xl leading-none">{game.score.toLocaleString("en-US")}</div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <Stat label="Best" value={game.best} tone="text-amber-300" />
            <Stat label="Lines" value={game.lines} tone="text-cyan-300" />
            <Stat label="Max combo" value={game.maxCombo} tone="text-pink-300" />
          </div>
          <button type="button" className="bb-btn bb-btn-primary mt-6 w-full" onClick={restart} autoFocus>
            <RestartIcon /> Play again
          </button>
        </Modal>
      )}
    </>
  );
}

function PieceView({ piece, cell, gap }: { piece: Piece; cell: string; gap: string }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${piece.shape.cols}, ${cell})`,
        gridTemplateRows: `repeat(${piece.shape.rows}, ${cell})`,
        gap,
      }}
    >
      {piece.shape.cells.map(([r, c]) => (
        <div
          key={`${r}-${c}`}
          className="bb-block"
          style={{ ...colorVars(piece.color), gridRow: r + 1, gridColumn: c + 1 }}
        />
      ))}
    </div>
  );
}

/** Score that counts up smoothly instead of jumping. */
function Counter({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    const format = (n: number) => n.toLocaleString("en-US");
    if (value <= from || prefersReducedMotion()) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    const start = performance.now();
    const duration = Math.min(650, 220 + (value - from) * 3);
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / duration);
      shown.current = Math.round(from + (value - from) * (1 - (1 - t) ** 3));
      el.textContent = format(shown.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span ref={ref} className={className} />;
}

function ScorePops({ pops }: { pops: ScorePop[] }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden>
      {pops.map((pop) => (
        <span key={pop.id} className="bb-score-pop">
          +{pop.value}
        </span>
      ))}
    </div>
  );
}

function ComboMeter({ combo, left, large = false }: { combo: number; left: number; large?: boolean }) {
  const active = combo > 0;
  return (
    <div className={cx("bb-combo", large && "bb-combo-lg", active && "bb-combo-on")}>
      <FlameIcon className="bb-combo-flame" />
      <span className="bb-display">{active ? `Combo ×${combo}` : "No combo"}</span>
      <span className="flex gap-1" aria-label={`${left} moves left to keep the combo`}>
        {Array.from({ length: COMBO_GRACE }, (_, i) => (
          <i key={i} className={cx("bb-combo-dot", i < left && "bb-combo-dot-on")} />
        ))}
      </span>
    </div>
  );
}

function BestChip({ best }: { best: number }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-black/25 py-1.5 pl-1.5 pr-4 ring-1 ring-white/15">
      <span className="grid size-8 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-orange-500 text-lg text-white shadow-[0_3px_0_#9a3412]">
        <CrownIcon />
      </span>
      <span className="bb-display text-xl text-amber-200">{best.toLocaleString("en-US")}</span>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="bb-icon-btn">
      {children}
    </button>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("bb-card", className)}>{children}</div>;
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/55">{children}</div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl bg-black/20 px-2 py-2.5 ring-1 ring-white/10">
      <div className={cx("bb-display text-2xl leading-none", tone)}>{value.toLocaleString("en-US")}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">{label}</div>
    </div>
  );
}

function Kbd({ keys }: { keys: string[] }) {
  return (
    <dt className="flex gap-1">
      {keys.map((k) => (
        <kbd key={k} className="bb-kbd">
          {k}
        </kbd>
      ))}
    </dt>
  );
}

function Modal({ children, onClose, delayed = false }: { children: ReactNode; onClose?: () => void; delayed?: boolean }) {
  return (
    <div
      className={cx("bb-modal", delayed && "bb-modal-delayed")}
      role="dialog"
      aria-modal
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="bb-modal-card">{children}</div>
    </div>
  );
}

function Logo({ className }: { className?: string }) {
  const word = (text: string, offset: number) =>
    [...text].map((ch, i) => (
      <span key={i} style={{ color: PALETTE[(i + offset) % PALETTE.length].c, "--i": i } as CSSProperties}>
        {ch}
      </span>
    ));
  return (
    <h1 className={cx("bb-logo", className)} aria-label="Block Blast">
      <span aria-hidden>{word("BLOCK", 0)}</span>
      <span aria-hidden>{word("BLAST", 4)}</span>
    </h1>
  );
}

function Splash() {
  return (
    <div className="relative z-10 flex h-full flex-col items-center justify-center gap-8">
      <Logo className="bb-logo-xl" />
      <div className="flex gap-2" aria-label="Loading">
        {[0, 3, 5].map((color, i) => (
          <div
            key={color}
            className="bb-block bb-bounce size-6"
            style={{ ...colorVars(color), "--cell": "24px", animationDelay: `${i * 120}ms` } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

const DECOR = [
  { left: "6%", top: "12%", size: 46, color: 0, delay: 0 },
  { left: "88%", top: "8%", size: 34, color: 4, delay: 1.2 },
  { left: "92%", top: "62%", size: 52, color: 2, delay: 2.1 },
  { left: "4%", top: "70%", size: 38, color: 6, delay: 0.6 },
  { left: "18%", top: "90%", size: 28, color: 3, delay: 1.8 },
  { left: "76%", top: "88%", size: 30, color: 7, delay: 2.6 },
  { left: "50%", top: "4%", size: 22, color: 5, delay: 3.1 },
];

function Backdrop() {
  return (
    <div className="bb-bg" aria-hidden>
      <span className="bb-blob bb-blob-1" />
      <span className="bb-blob bb-blob-2" />
      <span className="bb-blob bb-blob-3" />
      <div className="bb-bg-grid" />
      {DECOR.map((d, i) => (
        <div
          key={i}
          className="bb-block bb-deco"
          style={
            {
              ...colorVars(d.color),
              left: d.left,
              top: d.top,
              width: d.size,
              height: d.size,
              "--cell": `${d.size}px`,
              animationDelay: `${-d.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
