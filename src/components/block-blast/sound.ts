// Tiny Web Audio synth so the game has sound without shipping audio files.

type ToneOptions = {
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  slideTo?: number;
};

let context: AudioContext | null = null;
let muted = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(freq: number, duration: number, { type = "sine", gain = 0.12, delay = 0, slideTo }: ToneOptions = {}) {
  if (muted) return;
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

const MAJOR = [0, 4, 7, 12, 16, 19, 24];
const note = (semitones: number, root = 523.25) => root * 2 ** (semitones / 12);

export const sfx = {
  setMuted(value: boolean) {
    muted = value;
  },
  pick() {
    tone(620, 0.07, { type: "triangle", gain: 0.07, slideTo: 880 });
  },
  select() {
    tone(760, 0.06, { type: "triangle", gain: 0.06 });
  },
  drop() {
    tone(420, 0.09, { type: "triangle", gain: 0.05, slideTo: 260 });
  },
  place() {
    tone(210, 0.14, { gain: 0.22, slideTo: 95 });
    tone(1250, 0.03, { type: "square", gain: 0.018 });
  },
  invalid() {
    tone(160, 0.16, { type: "sawtooth", gain: 0.045, slideTo: 100 });
  },
  clear(lines: number, combo: number) {
    const lift = Math.min(combo - 1, 7);
    const steps = Math.min(lines + 2, MAJOR.length);
    for (let i = 0; i < steps; i += 1) {
      tone(note(MAJOR[i] + lift), 0.22, { type: "triangle", gain: 0.1, delay: i * 0.055 });
    }
    tone(note(MAJOR[steps - 1] + lift + 12), 0.35, { gain: 0.05, delay: steps * 0.055 });
  },
  perfect() {
    [0, 4, 7, 12, 16, 19, 24].forEach((step, i) =>
      tone(note(step, 659.25), 0.3, { type: "triangle", gain: 0.08, delay: 0.35 + i * 0.07 }),
    );
  },
  start() {
    [0, 7, 12].forEach((step, i) => tone(note(step), 0.15, { type: "triangle", gain: 0.08, delay: i * 0.07 }));
  },
  gameOver() {
    [12, 7, 3, 0].forEach((step, i) =>
      tone(note(step, 392), 0.32, { type: "triangle", gain: 0.09, delay: i * 0.16 }),
    );
  },
};
