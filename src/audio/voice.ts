/**
 * Animal Crossing-style "babble": a short pitched blip for every couple of letters, made with
 * WebAudio (no sound files). Each character has their own pitch and tone. On by default, with
 * a mute switch remembered on this device.
 */

export interface Voice {
  /** Base pitch in Hz: higher for bright voices, lower for calm ones. */
  pitch: number;
  wave: OscillatorType;
  /** How much the pitch wanders from blip to blip (0 to 1). */
  range: number;
}

const KEY = 'careerPlaza.voice';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
})();
let count = 0;

export const isMuted = () => muted;

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? 'off' : 'on');
  } catch {
    /* private mode: the choice lasts this visit only */
  }
}

/** Browsers only allow sound after a click or key press, so this is called from those. */
export function unlockAudio() {
  if (ctx || typeof AudioContext === 'undefined') {
    void ctx?.resume();
    return;
  }
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(ctx.destination);
}

/** One blip for a typed letter (spaces and punctuation are silent; every other letter sounds). */
export function blip(v: Voice, ch: string) {
  if (muted || !ctx || !master || ctx.state !== 'running') return;
  if (!/[a-z0-9]/i.test(ch)) return;
  if (count++ % 2) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  // Vowels sit a little higher, which gives the babble its sing-song feel.
  const lift = /[aeiou]/i.test(ch) ? 1.12 : 1;
  const wobble = 1 + (((ch.toLowerCase().charCodeAt(0) * 37) % 13) / 13 - 0.5) * v.range;
  osc.type = v.wave;
  osc.frequency.setValueAtTime(v.pitch * lift * wobble, t);
  osc.frequency.exponentialRampToValueAtTime(v.pitch * lift * wobble * 0.86, t + 0.07);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(1, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.09);
}

/** A soft two-note chime for "you found something". */
export function chime() {
  if (muted || !ctx || !master || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  [660, 990].forEach((f, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.8, t + i * 0.12 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.5);
    osc.connect(gain).connect(master!);
    osc.start(t + i * 0.12);
    osc.stop(t + i * 0.12 + 0.55);
  });
}

/** A steady voice for anyone, from their name, so every colleague sounds a little different. */
export function voiceFor(name: string, preset?: Partial<Voice>): Voice {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { pitch: 300 + (h % 220), wave: (['triangle', 'square', 'sine'] as const)[h % 3], range: 0.35, ...preset };
}
