import { blip, unlockAudio, type Voice } from '../audio/voice';
import { reducedMotion, type Mood } from '../world/types';
import { h } from './dom';

/**
 * The Animal Crossing-style talk box: a rounded cream speech blob along the bottom of the screen,
 * a tilted name tag in the speaker's colour, letters that pop in with a babble voice, one short
 * page at a time, and a bouncing arrow to carry on. The player's replies are bubbles on the right.
 */

export interface Speaker {
  name: string;
  color: string;
  /** Small portrait image (a Kenney character preview), if any. */
  portrait?: string;
  voice?: Voice;
}

export interface TalkHooks {
  /** A page starts (talking = true) or finishes typing (false). Mood is set on a page's first letter. */
  onSpeak(talking: boolean, mood: Mood | null): void;
  announce(text: string): void;
}

const MOODS: Mood[] = ['happy', 'excited', 'surprised', 'thinking', 'worried', 'proud', 'love', 'idea'];

/** A light guess at the feeling behind a line, for lines without a [mood] tag (including AI lines). */
export function guessMood(text: string): Mood | null {
  const t = text.toLowerCase();
  if (/\b(bad news|sorry|unfortunately|worr|tight|risk|dip|rain|no pressure)/.test(t)) return 'worried';
  if (/\b(interesting|hmm|wonder|curious|what do you think|why)\b/.test(t) || /\?\s*$/.test(t)) return 'thinking';
  if (/\b(love|lovely|wonderful|so glad)\b/.test(t)) return 'love';
  if (/\b(great|nice|good|perfect|brilliant|smart|yes)\b/.test(t)) return 'happy';
  if (/!/.test(t)) return 'excited';
  if (/\b(idea|maybe try|could)\b/.test(t)) return 'idea';
  return null;
}

/** Pull a leading [mood] tag off a line. */
export function splitMood(text: string): { mood: Mood | null; text: string } {
  const m = /^\s*\[([a-z]+)\]\s*/.exec(text);
  if (m && MOODS.includes(m[1] as Mood)) return { mood: m[1] as Mood, text: text.slice(m[0].length) };
  return { mood: null, text };
}

/** Split a line into short pages of whole sentences, about two lines of the box each. */
function pages(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > max) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const plain = (text: string) => text.replace(/\*/g, '');

export class Talk {
  readonly el: HTMLElement;
  private box: HTMLElement;
  private tag: HTMLElement;
  private textEl: HTMLElement;
  private nextEl: HTMLElement;
  private extra: HTMLElement;
  private choices: HTMLElement;
  private advance: (() => void) | null = null;
  private finishPage: (() => void) | null = null;
  private token = 0;

  constructor(private hooks: TalkHooks) {
    this.tag = h('div', { class: 'talk-tag' });
    this.textEl = h('p', { class: 'talk-text' });
    this.nextEl = h('button', { class: 'talk-next', type: 'button', 'aria-label': 'Next' }, '▼');
    this.extra = h('div', { class: 'talk-extra' });
    this.box = h('div', { class: 'talk-box', role: 'group', 'aria-label': 'Conversation' }, this.tag, this.textEl, this.nextEl, this.extra);
    this.choices = h('div', { class: 'talk-choices', role: 'group', 'aria-label': 'Your reply' });
    this.el = h('div', { class: 'talk', hidden: true }, this.choices, this.box);
    this.box.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.talk-extra')) return;
      this.poke();
    });
    document.addEventListener('keydown', (e) => {
      if (this.el.hidden || !this.el.isConnected) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.talk-extra, .talk-choices, textarea, input, .colleague-wrap')) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 'e') {
        e.preventDefault();
        this.poke();
      }
    });
  }

  get open() {
    return !this.el.hidden;
  }

  /** A click or key: finish the typing, or go to the next page. */
  private poke() {
    unlockAudio();
    if (this.finishPage) this.finishPage();
    else this.advance?.();
  }

  private setSpeaker(sp: Speaker | null) {
    this.tag.replaceChildren();
    this.box.classList.toggle('narration', !sp);
    if (!sp) {
      this.tag.hidden = true;
      return;
    }
    this.tag.hidden = false;
    this.tag.style.setProperty('--c', sp.color);
    if (sp.portrait) this.tag.append(h('img', { src: sp.portrait, alt: '', width: 32, height: 32 }));
    this.tag.append(h('span', null, sp.name));
  }

  /**
   * Say a line, page by page. Without `controls`, resolves after the last page is read.
   * With `controls`, they appear in the box after the last page and this resolves at once.
   * `speaker` null is narration (looking at things), with no name tag.
   */
  async say(speaker: Speaker | null, line: string, opts: { controls?: HTMLElement | null; mood?: Mood | null } = {}): Promise<void> {
    const token = ++this.token;
    this.el.hidden = false;
    this.choices.replaceChildren();
    this.extra.replaceChildren();
    this.setSpeaker(speaker);
    const { mood: tagged, text } = splitMood(line);
    const mood = opts.mood !== undefined ? opts.mood : (tagged ?? (speaker ? guessMood(text) : null));
    const max = window.innerWidth < 600 ? 90 : 130;
    const list = pages(text, max);
    for (let i = 0; i < list.length; i++) {
      if (token !== this.token) return;
      const last = i === list.length - 1;
      await this.typePage(list[i], speaker, i === 0 ? mood : null);
      if (token !== this.token) return;
      if (last && opts.controls) {
        this.nextEl.hidden = true;
        this.extra.replaceChildren(opts.controls);
        opts.controls.querySelector<HTMLElement>('button, textarea, input, a')?.focus({ preventScroll: true });
        return;
      }
      this.nextEl.hidden = false;
      this.nextEl.focus({ preventScroll: true });
      await new Promise<void>((r) => (this.advance = r));
      this.advance = null;
    }
    this.nextEl.hidden = true;
  }

  private typePage(page: string, speaker: Speaker | null, mood: Mood | null): Promise<void> {
    this.nextEl.hidden = true;
    this.textEl.replaceChildren();
    const instant = reducedMotion();
    this.hooks.announce(`${speaker ? `${speaker.name}: ` : ''}${plain(page)}`);
    this.hooks.onSpeak(!!speaker, mood);
    // Letters, with *starred* words picked out in the speaker's colour
    const chars: { ch: string; key: boolean }[] = [];
    let key = false;
    for (const ch of page) {
      if (ch === '*') {
        key = !key;
        continue;
      }
      chars.push({ ch, key });
    }
    const spans = chars.map(({ ch, key: k }) => h('span', { class: `${k ? 'key' : ''} ${instant ? '' : 'pre'}` }, ch));
    this.textEl.append(...spans);
    if (instant) {
      this.hooks.onSpeak(false, null);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let i = 0;
      let timer = 0;
      const done = () => {
        window.clearTimeout(timer);
        spans.forEach((s) => s.classList.remove('pre'));
        this.finishPage = null;
        this.hooks.onSpeak(false, null);
        resolve();
      };
      this.finishPage = done;
      const step = () => {
        if (i >= spans.length) return done();
        const { ch } = chars[i];
        spans[i].classList.remove('pre');
        if (speaker?.voice) blip(speaker.voice, ch);
        i++;
        const pause = /[.!?]/.test(ch) ? 220 : ch === ',' ? 110 : 24;
        timer = window.setTimeout(step, pause);
      };
      step();
    });
  }

  /** Reply bubbles on the right. Resolves with the chosen index. */
  choose(options: string[]): Promise<number> {
    const token = this.token;
    this.el.hidden = false;
    this.nextEl.hidden = true;
    return new Promise((resolve) => {
      const buttons = options.map((label, i) =>
        h(
          'button',
          {
            class: 'talk-choice',
            type: 'button',
            style: `--i:${i}`,
            onclick: () => {
              unlockAudio();
              if (token !== this.token) return;
              this.choices.replaceChildren();
              resolve(i);
            },
          },
          label,
        ),
      );
      this.choices.replaceChildren(...buttons);
      buttons[0]?.focus({ preventScroll: true });
    });
  }

  hide() {
    this.token++;
    this.finishPage?.();
    this.advance?.();
    this.el.hidden = true;
    this.choices.replaceChildren();
    this.extra.replaceChildren();
    this.textEl.replaceChildren();
  }
}
