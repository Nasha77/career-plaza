import { CONTENT, SCENARIO_IDS, getScenario } from '../content';
import type { FeedbackProvider, FeedbackResult } from '../feedback/provider';
import { ScriptedProvider } from '../feedback/scripted';
import { buildRecord, exploredIds, guideLine, joinList, ratingWord, recordAsText, type GrowthRecord } from '../record';
import { clearState, loadState, saveState } from '../store';
import type { Attempt, ChoiceId, Rating, SaveState, Scenario, ScenarioId, SkillName } from '../types';
import { reducedMotion, type World } from '../world/types';
import {
  buildingIcon,
  h,
  isTyping,
  ratingDots,
  skillChip,
  skillClass,
  skillGlyph,
  skipTyping,
  typeText,
  uid,
} from './dom';

type Screen = 'title' | 'plaza' | 'scenario' | 'record';
type Step = 'intro' | 'choose' | 'write' | 'feedback' | 'reflect' | 'rate';

interface Run {
  scenario: Scenario;
  isRevisit: boolean;
  startedAt: string;
  step: Step;
  choiceId?: ChoiceId;
  written?: string;
  feedback?: FeedbackResult;
  reflection?: string;
  enjoyment?: Rating;
  confidence?: Rating;
  wantsMore: boolean;
}

export interface Elements {
  hud: HTMLElement;
  stage: HTMLElement;
  live: HTMLElement;
  floats: HTMLElement;
}

export interface AppOptions {
  world: World;
  webglFailed: boolean;
  /** Swaps the 3D world for the flat one. */
  toSimple: () => World;
}

const NPC_COLOR: Record<ScenarioId | 'guide', string> = {
  guide: 'var(--brand)',
  consulting: '#34465E',
  classroom: '#D9694C',
  data: '#B88A12',
  research: '#8C3B4A',
};

export class App {
  private save: SaveState = loadState();
  private world: World;
  private provider: FeedbackProvider = new ScriptedProvider();
  private screen: Screen = 'title';
  private run: Run | null = null;
  private busy = false;
  private webglFailed: boolean;
  private justFinished: ScenarioId | null = null;

  constructor(private els: Elements, private opts: AppOptions) {
    this.world = opts.world;
    this.webglFailed = opts.webglFailed;
    this.bindWorld();
    this.world.setVisited(exploredIds(this.save.attempts));
    document.addEventListener('keydown', (e) => {
      if (!isTyping()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        skipTyping();
      }
    });
    this.showTitle();
  }

  private bindWorld() {
    this.world.onPick = (id) => {
      if (this.screen === 'plaza') void this.enterBuilding(id);
    };
    this.world.onHover = (id) => {
      document.querySelectorAll<HTMLElement>('.bbtn').forEach((b) => {
        b.classList.toggle('hovered', b.dataset.id === id);
      });
    };
  }

  private get attempts() {
    return this.save.attempts;
  }

  private announce(text: string) {
    this.els.live.textContent = '';
    window.setTimeout(() => (this.els.live.textContent = text), 30);
  }

  private setScreen(s: Screen) {
    this.screen = s;
    document.body.dataset.screen = s;
    this.renderHud();
  }

  // ---- HUD ----------------------------------------------------------------

  private renderHud() {
    const hud = this.els.hud;
    hud.replaceChildren();
    if (this.screen === 'title') return;
    const explored = exploredIds(this.attempts);

    let left: HTMLElement;
    if (this.screen === 'scenario') {
      left = h('button', { class: 'btn ghost back', type: 'button', onclick: () => void this.leaveScenario() }, h('span', { 'aria-hidden': 'true' }, '←'), ' Plaza');
    } else if (this.screen === 'record') {
      left = h('button', { class: 'btn ghost back', type: 'button', onclick: () => this.backToPlazaFromRecord() }, h('span', { 'aria-hidden': 'true' }, '←'), ' Plaza');
    } else {
      left = h('span', { class: 'wordmark' }, 'Career Plaza');
    }

    const pips = SCENARIO_IDS.map((id) =>
      h('span', { class: `pip ${explored.includes(id) ? 'lit' : ''}`, title: getScenario(id).building }, buildingIcon(id)),
    );
    const map = h(
      'div',
      { class: 'mapstat', role: 'status' },
      h('span', { class: 'pips', 'aria-hidden': 'true' }, pips),
      h('span', null, `Career map: ${explored.length} of 4 explored`),
    );

    let right: HTMLElement | null = null;
    if (this.screen === 'plaza') {
      const enabled = this.attempts.length > 0;
      right = h(
        'button',
        {
          class: 'btn small',
          type: 'button',
          disabled: !enabled,
          'aria-describedby': enabled ? undefined : 'rec-hint',
          onclick: () => this.showRecord(),
        },
        h('span', { class: 'long' }, 'My growth record'),
        h('span', { class: 'short' }, 'My record'),
      );
      if (!enabled) right = h('div', { class: 'recwrap' }, right, h('span', { id: 'rec-hint', class: 'sr-only' }, 'Finish one building to open your growth record.'));
    }
    hud.append(left, map, right ?? h('span', { class: 'hud-spacer' }));
  }

  // ---- Title ----------------------------------------------------------------

  private showTitle() {
    this.setScreen('title');
    this.world.setActive(true);
    const hasProgress = this.attempts.length > 0;
    const card = h(
      'section',
      { class: 'title-card card', 'aria-labelledby': 'title-h' },
      h('p', { class: 'kicker' }, 'Humancareers · Part 1'),
      h('h1', { id: 'title-h' }, 'Career Plaza'),
      h('p', { class: 'pitch' }, 'Step into four workplaces and try the work for a few minutes each. See what you used, what you enjoyed, and where to go next.'),
      h('p', { class: 'promise' }, h('strong', null, 'No scores. No wrong answers.'), ' About 8 to 10 minutes.'),
      this.webglFailed
        ? h('p', { class: 'notice', role: 'note' }, "3D couldn't start on this device, so you'll play in Simple mode. Everything else works the same.")
        : null,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: () => this.showPlaza() }, hasProgress ? 'Continue exploring' : 'Start'),
        this.world.mode === '3d'
          ? h('button', { class: 'btn ghost', type: 'button', onclick: () => this.switchToSimple() }, 'Simple mode (no 3D)')
          : null,
      ),
    );
    this.els.stage.replaceChildren(h('div', { class: 'title-wrap' }, card));
    (card.querySelector('.btn.primary') as HTMLElement | null)?.focus();
  }

  private switchToSimple() {
    this.world.dispose();
    this.world = this.opts.toSimple();
    this.bindWorld();
    this.showPlaza();
  }

  // ---- Plaza ----------------------------------------------------------------

  private showPlaza() {
    this.setScreen('plaza');
    this.world.setActive(true);
    const explored = exploredIds(this.attempts);
    this.world.setVisited(explored);
    const simple = this.world.mode === 'simple';
    const line = guideLine(this.attempts);

    const buttons = SCENARIO_IDS.map((id) => {
      const s = getScenario(id);
      const visited = explored.includes(id);
      return h(
        'button',
        {
          class: `bbtn b-${id} ${visited ? 'visited' : ''}`,
          type: 'button',
          'data-id': id,
          'aria-label': `${s.building}, with ${s.npc.name}. ${visited ? 'Explored. Enter again for a new twist.' : 'Not explored yet.'}`,
          onclick: () => void this.enterBuilding(id),
          onmouseenter: () => this.world.setHover(id),
          onmouseleave: () => this.world.setHover(null),
          onfocus: () => this.world.setHover(id),
          onblur: () => this.world.setHover(null),
        },
        h('span', { class: 'bicon-wrap' }, buildingIcon(id)),
        h(
          'span',
          { class: 'btext' },
          h('span', { class: 'bname' }, s.building),
          simple ? h('span', { class: 'bdesc' }, `${s.npc.name}, ${s.npc.role.toLowerCase()}. ${s.setting}`) : null,
          h('span', { class: 'bstatus' }, visited ? (simple ? '✓ Explored · new twist inside' : '✓ Explored') : 'New'),
        ),
      );
    });

    const guideText = h('p', { class: 'say' });
    const sheet = h(
      'section',
      { class: `plaza-sheet card ${simple ? 'simple' : ''}`, 'aria-labelledby': 'plaza-h' },
      h(
        'div',
        { class: 'speaker' },
        h('span', { class: 'avatar', style: `--c:${NPC_COLOR.guide}`, 'aria-hidden': 'true' }, 'G'),
        h('span', null, h('strong', null, CONTENT.guide.name), h('span', { class: 'role' }, 'Plaza guide')),
      ),
      guideText,
      h('h2', { id: 'plaza-h', class: 'label' }, 'Choose a building'),
      h('div', { class: `bgrid ${simple ? 'simple' : ''}` }, buttons),
      this.attempts.length >= 2
        ? h('button', { class: 'btn primary wide', type: 'button', onclick: () => this.showRecord() }, 'Look at my growth record')
        : null,
    );
    const wrap = h('div', { class: `plaza-wrap ${simple ? 'simple' : ''}` }, simple ? this.simpleMap(explored) : null, sheet);
    this.els.stage.replaceChildren(wrap);

    this.world.setTalking('guide');
    this.announce(`${CONTENT.guide.name}: ${line}`);
    void typeText(guideText, line, reducedMotion()).then(() => {
      window.setTimeout(() => this.screen === 'plaza' && this.world.setTalking(null), 1200);
    });

    if (this.justFinished) {
      this.world.celebrate(this.justFinished);
      const btn = wrap.querySelector<HTMLElement>(`.bbtn[data-id="${this.justFinished}"]`);
      btn?.classList.add('fresh');
      this.justFinished = null;
    }
  }

  /** In Simple mode, a flat illustrated plaza stands in for the 3D scene. */
  private simpleMap(explored: ScenarioId[]): HTMLElement {
    const fig = h('figure', { class: 'simple-map', 'aria-hidden': 'true' });
    fig.append(careerMapSvg(explored));
    return fig;
  }

  // ---- Scenario -------------------------------------------------------------

  private async enterBuilding(id: ScenarioId) {
    if (this.busy) return;
    this.busy = true;
    const scenario = getScenario(id);
    this.run = {
      scenario,
      isRevisit: this.attempts.some((a) => a.scenarioId === id),
      startedAt: new Date().toISOString(),
      step: 'intro',
      wantsMore: false,
    };
    this.world.setHover(null);
    this.world.setTalking(null);
    this.els.stage.replaceChildren();
    try {
      await this.world.enter(id, () => {
        this.setScreen('scenario');
        this.renderStep();
      });
    } finally {
      this.busy = false;
    }
  }

  private async leaveScenario() {
    if (this.busy || !this.run) return;
    if (this.run.choiceId) {
      const ok = await confirmDialog({
        title: 'Leave this building?',
        body: "This attempt won't be saved. You can come back any time.",
        confirm: 'Leave',
        cancel: 'Stay',
      });
      if (!ok) return;
    }
    await this.exitToPlaza();
  }

  private async exitToPlaza() {
    this.busy = true;
    this.run = null;
    this.world.setTalking(null);
    this.els.floats.replaceChildren();
    try {
      await this.world.exit(() => this.showPlaza());
    } finally {
      this.busy = false;
    }
  }

  private dialogueCard(run: Run, bodyChildren: (Node | null)[]): HTMLElement {
    const s = run.scenario;
    return h(
      'section',
      { class: 'dialogue card', 'aria-labelledby': 'npc-name' },
      h(
        'div',
        { class: 'speaker' },
        h('span', { class: 'avatar', style: `--c:${NPC_COLOR[s.id]}`, 'aria-hidden': 'true' }, s.npc.name.replace('Professor ', '')[0]),
        h('span', null, h('strong', { id: 'npc-name' }, s.npc.name), h('span', { class: 'role' }, `${s.npc.role} · ${s.building}`)),
        h('span', { class: 'steps', 'aria-label': `Step ${stepIndex(run.step) + 1} of 6` }, STEPS.map((st) => h('span', { class: `sdot ${stepIndex(st) <= stepIndex(run.step) ? 'on' : ''}` }))),
      ),
      ...bodyChildren,
    );
  }

  /** Types NPC lines one after another, then reveals the controls. */
  private async speak(lines: HTMLElement[], texts: string[], after: HTMLElement) {
    after.hidden = true;
    this.world.setTalking('npc');
    this.announce(texts.join(' '));
    const instant = reducedMotion();
    for (let i = 0; i < lines.length; i++) {
      await typeText(lines[i], texts[i], instant);
    }
    this.world.setTalking(null);
    after.hidden = false;
    after.querySelector<HTMLElement>('button, textarea, input')?.focus({ preventScroll: true });
  }

  private renderStep() {
    const run = this.run;
    if (!run) return;
    const s = run.scenario;
    const stage = this.els.stage;
    const say = () => h('p', { class: 'say', onclick: skipTyping });

    switch (run.step) {
      case 'intro': {
        const l1 = say();
        const twist = run.isRevisit ? h('p', { class: 'twist' }, h('span', { class: 'twist-tag' }, 'New this time'), h('span', { class: 'twist-text' })) : null;
        const controls = h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this.go('choose') }, 'Continue'));
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [h('p', { class: 'setting' }, s.setting), l1, twist, controls])));
        const lines: HTMLElement[] = [l1];
        const texts = [s.intro];
        if (twist) {
          lines.push(twist.querySelector('.twist-text') as HTMLElement);
          texts.push(s.twist);
        }
        void this.speak(lines, texts, controls);
        break;
      }
      case 'choose': {
        const q = say();
        const opts = h(
          'div',
          { class: 'options', role: 'group', 'aria-label': 'Your options' },
          s.options.map((o) =>
            h(
              'button',
              { class: 'option', type: 'button', onclick: () => this.choose(o.id) },
              h('span', { class: 'okey', 'aria-hidden': 'true' }, o.id),
              h('span', null, o.text),
            ),
          ),
        );
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [q, opts])));
        void this.speak([q], [s.question], opts);
        break;
      }
      case 'write': {
        const p = say();
        const ta = h('textarea', {
          id: 'write',
          rows: 3,
          maxlength: 400,
          placeholder: 'Write a sentence or two…',
          'aria-labelledby': 'write-l',
        }) as HTMLTextAreaElement;
        if (run.written) ta.value = run.written;
        const controls = h(
          'div',
          { class: 'block' },
          h('label', { id: 'write-l', class: 'label', for: 'write' }, 'Your words (saved as a work sample)'),
          ta,
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => void this.submitWriting(ta.value) }, 'Continue'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => void this.submitWriting('') }, 'Skip'),
          ),
        );
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [p, controls])));
        void this.speak([p], [s.writePrompt], controls);
        break;
      }
      case 'feedback': {
        const fb = run.feedback!;
        const r = say();
        const ack = fb.acknowledgement ? say() : null;
        const chips = h(
          'div',
          { class: 'block' },
          h('p', { class: 'label' }, 'Skills you used here'),
          h('div', { class: 'chips' }, fb.skills.map((sk) => skillChip(sk.skill, sk.weight === 2 ? 'main' : 'also'))),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this.go('reflect') }, 'Continue')),
        );
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [r, ack, chips])));
        const lines: HTMLElement[] = [r];
        const texts = [fb.npcReaction];
        if (ack && fb.acknowledgement) {
          lines.push(ack);
          texts.push(fb.acknowledgement);
        }
        void this.speak(lines, texts, chips).then(() => this.floatSkills(fb.skills));
        break;
      }
      case 'reflect': {
        const fb = run.feedback!;
        const q = say();
        q.classList.add('question');
        const ta = h('textarea', { id: 'reflect', rows: 3, maxlength: 400, placeholder: 'A few words for yourself (optional)', 'aria-labelledby': 'reflect-l' }) as HTMLTextAreaElement;
        if (run.reflection) ta.value = run.reflection;
        const controls = h(
          'div',
          { class: 'block' },
          h('label', { id: 'reflect-l', class: 'label', for: 'reflect' }, 'Your reflection (only you see this)'),
          ta,
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => this.saveReflection(ta.value) }, 'Save and continue'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => this.saveReflection('') }, 'Skip'),
          ),
        );
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [h('p', { class: 'label soft' }, 'A question to think about'), q, controls])));
        void this.speak([q], [fb.reflectiveQuestion], controls);
        break;
      }
      case 'rate': {
        this.world.setTalking(null);
        const finish = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => void this.finish() }, 'Finish and go back to the plaza');
        const hint = h('p', { class: 'hint', id: 'rate-hint' }, 'Pick one for each question.');
        const update = () => {
          const ready = !!(run.enjoyment && run.confidence);
          finish.toggleAttribute('disabled', !ready);
          hint.hidden = ready;
        };
        const scale = (key: 'enjoyment' | 'confidence', legend: string, lo: string, hi: string) =>
          h(
            'fieldset',
            { class: 'scale' },
            h('legend', null, legend),
            h(
              'div',
              { class: 'scale-row' },
              [1, 2, 3, 4, 5].map((n) =>
                h(
                  'label',
                  { class: 'pill' },
                  h('input', {
                    type: 'radio',
                    name: key,
                    value: n,
                    checked: run[key] === n,
                    onchange: () => {
                      run[key] = n as Rating;
                      update();
                    },
                  }),
                  h('span', null, String(n)),
                ),
              ),
            ),
            h('div', { class: 'scale-ends', 'aria-hidden': 'true' }, h('span', null, lo), h('span', null, hi)),
          );
        const more = h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox', checked: run.wantsMore, onchange: (e: Event) => (run.wantsMore = (e.target as HTMLInputElement).checked) }),
          h('span', null, "I'd like to try more like this"),
        );
        const card = this.dialogueCard(run, [
          h('h2', { class: 'rate-h' }, 'Before you head out'),
          h('p', { class: 'soft' }, 'Just for you. This is how you felt, not how you did.'),
          scale('enjoyment', 'How much did you enjoy this?', '1 not much', '5 a lot'),
          scale('confidence', 'How confident did you feel?', '1 not very', '5 very'),
          more,
          hint,
          h('div', { class: 'actions' }, finish),
        ]);
        stage.replaceChildren(this.wrapScenario(card));
        update();
        (card.querySelector('input') as HTMLElement | null)?.focus({ preventScroll: true });
        this.announce('Rate how much you enjoyed this and how confident you felt.');
        break;
      }
    }
  }

  private wrapScenario(card: HTMLElement) {
    return h('div', { class: 'scenario-wrap' }, card);
  }

  private go(step: Step) {
    if (!this.run) return;
    this.run.step = step;
    this.renderStep();
  }

  private choose(id: ChoiceId) {
    if (!this.run) return;
    this.run.choiceId = id;
    this.go('write');
  }

  private async submitWriting(text: string) {
    const run = this.run;
    if (!run || !run.choiceId) return;
    run.written = text.trim() || undefined;
    run.feedback = await this.provider.getFeedback({
      scenarioId: run.scenario.id,
      choiceId: run.choiceId,
      writtenResponse: run.written,
      isRevisit: run.isRevisit,
      twist: run.isRevisit ? run.scenario.twist : undefined,
    });
    if (this.run === run) this.go('feedback');
  }

  private saveReflection(text: string) {
    if (!this.run) return;
    this.run.reflection = text.trim() || undefined;
    this.go('rate');
  }

  private floatSkills(skills: { skill: SkillName; weight: 1 | 2 }[]) {
    const anchor = this.world.npcAnchor() ?? {
      x: window.innerWidth / 2,
      y: Math.min(window.innerHeight * 0.3, 260),
    };
    skills.forEach((s, i) => {
      const tag = h(
        'span',
        { class: `float-tag ${skillClass(s.skill)} ${s.weight === 2 ? 'main' : ''}`, 'aria-hidden': 'true', style: `left:${anchor.x + (i - (skills.length - 1) / 2) * 150}px;top:${anchor.y + i * 40}px;animation-delay:${i * 260}ms` },
        skillGlyph(s.skill),
        `+ ${s.skill}`,
      );
      tag.addEventListener('animationend', () => tag.remove());
      this.els.floats.append(tag);
    });
  }

  private async finish() {
    const run = this.run;
    if (!run || !run.choiceId || !run.feedback || !run.enjoyment || !run.confidence || this.busy) return;
    const attempt: Attempt = {
      id: uid(),
      scenarioId: run.scenario.id,
      startedAt: run.startedAt,
      choiceId: run.choiceId,
      writtenResponse: run.written,
      reflectionNote: run.reflection,
      enjoyment: run.enjoyment,
      confidence: run.confidence,
      wantsMore: run.wantsMore,
      isRevisit: run.isRevisit,
      skills: run.feedback.skills.map((s) => ({ skill: s.skill, weight: s.weight })),
    };
    this.save = { version: 1, attempts: [...this.attempts, attempt] };
    saveState(this.save);
    this.justFinished = attempt.scenarioId;
    await this.exitToPlaza();
  }

  // ---- Growth record --------------------------------------------------------

  private showRecord() {
    if (!this.attempts.length) return;
    this.setScreen('record');
    this.world.setActive(false);
    const r = buildRecord(this.attempts);
    const page = renderRecord(r, {
      onCopy: (btn, fallback) => void copyText(recordAsText(r), btn, fallback),
      onStartOver: () => void this.startOver(),
      onPlaza: () => this.backToPlazaFromRecord(),
    });
    this.els.stage.replaceChildren(page);
    page.scrollTop = 0;
    page.querySelector<HTMLElement>('h1')?.focus();
  }

  private backToPlazaFromRecord() {
    this.showPlaza();
  }

  private async startOver() {
    const ok = await confirmDialog({
      title: 'Start over?',
      body: 'This clears every attempt, rating and note on this device. It cannot be undone.',
      confirm: 'Clear and start over',
      cancel: 'Keep my record',
      danger: true,
    });
    if (!ok) return;
    this.save = clearState();
    this.world.setVisited([]);
    this.showTitle();
  }
}

const STEPS: Step[] = ['intro', 'choose', 'write', 'feedback', 'reflect', 'rate'];
const stepIndex = (s: Step) => STEPS.indexOf(s);

// ---- Growth record rendering -------------------------------------------------

function renderRecord(
  r: GrowthRecord,
  on: { onCopy: (btn: HTMLButtonElement, fallback: HTMLElement) => void; onStartOver: () => void; onPlaza: () => void },
): HTMLElement {
  const name = (id: ScenarioId) => getScenario(id).building;
  const maxSkill = Math.max(1, ...r.skills.map((s) => s.total));

  const tried = h(
    'ol',
    { class: 'attempts' },
    [...r.attempts].reverse().map((a) => {
      const s = getScenario(a.scenarioId);
      const opt = s.options.find((o) => o.id === a.choiceId);
      return h(
        'li',
        { class: 'attempt' },
        h(
          'div',
          { class: 'attempt-head' },
          h('span', { class: `bicon-wrap b-${a.scenarioId}` }, buildingIcon(a.scenarioId)),
          h('strong', null, s.building),
          a.isRevisit ? h('span', { class: 'tag' }, 'Revisit') : null,
          h('time', { datetime: a.startedAt }, formatWhen(a.startedAt)),
        ),
        h('p', null, h('span', { class: 'k' }, 'You chose: '), opt?.text ?? ''),
        a.writtenResponse
          ? h('blockquote', { class: 'sample' }, h('span', { class: 'k' }, 'Your words: '), `“${a.writtenResponse}”`)
          : h('p', { class: 'soft' }, 'No written response this time.'),
        a.reflectionNote ? h('p', { class: 'note' }, h('span', { class: 'k' }, 'Your reflection: '), a.reflectionNote) : null,
      );
    }),
  );

  const enjoyed = h(
    'ul',
    { class: 'enjoy-list' },
    r.buildings.map((b) =>
      h(
        'li',
        { class: `enjoy ${b.wantsMore ? 'wants' : ''}` },
        h('div', { class: 'enjoy-name' }, h('span', { class: `bicon-wrap b-${b.id}` }, buildingIcon(b.id)), h('strong', null, b.name)),
        h('div', { class: 'enjoy-row' }, h('span', { class: 'k' }, 'Enjoyed'), ratingDots(b.enjoyment, `Enjoyed ${ratingWord(b.enjoyment)}`), h('span', { class: 'rw' }, ratingWord(b.enjoyment))),
        h('div', { class: 'enjoy-row' }, h('span', { class: 'k' }, 'Confident'), ratingDots(b.confidence, `Felt confident ${ratingWord(b.confidence)}`), h('span', { class: 'rw' }, ratingWord(b.confidence))),
        b.wantsMore ? h('p', { class: 'wants-tag' }, '★ You’d like to try more like this') : null,
      ),
    ),
  );

  const skills = h(
    'ul',
    { class: 'skill-list' },
    r.skills.map((s) =>
      h(
        'li',
        { class: `skill-row ${skillClass(s.skill)}` },
        h('div', { class: 'skill-name' }, skillGlyph(s.skill), h('strong', null, s.skill)),
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${(s.total / maxSkill) * 100}%` })),
        h(
          'p',
          { class: 'used-in' },
          s.buildings.length
            ? [h('span', { class: 'k' }, 'Used in: '), joinList(s.buildings.map(name))]
            : h('span', { class: 'soft' }, 'Not used yet'),
        ),
      ),
    ),
  );

  const transfer = r.skills.filter((s) => s.buildings.length > 1);

  const compare = h(
    'div',
    { class: 'table-wrap', tabindex: 0, role: 'region', 'aria-label': 'Compare the buildings you tried' },
    h(
      'table',
      { class: 'compare' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Building'), h('th', { scope: 'col' }, 'Enjoyed'), h('th', { scope: 'col' }, 'Confident'), h('th', { scope: 'col' }, 'Skills used'), h('th', { scope: 'col' }, 'Visits'))),
      h(
        'tbody',
        null,
        r.buildings.map((b) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, b.name),
            h('td', null, ratingDots(b.enjoyment, `Enjoyed ${ratingWord(b.enjoyment)}`)),
            h('td', null, ratingDots(b.confidence, `Confident ${ratingWord(b.confidence)}`)),
            h('td', null, h('div', { class: 'chips tight' }, b.skills.map((sk) => skillChip(sk)))),
            h('td', null, String(b.attempts)),
          ),
        ),
      ),
    ),
  );

  const fallback = h('div', { class: 'copy-fallback', hidden: true });
  const copyBtn = h('button', { class: 'btn', type: 'button' }, 'Copy my growth record') as HTMLButtonElement;
  copyBtn.addEventListener('click', () => on.onCopy(copyBtn, fallback));

  const section = (id: string, title: string, intro: string | null, ...body: (Node | null)[]) =>
    h('section', { class: 'rsec card', 'aria-labelledby': id }, h('h2', { id }, title), intro ? h('p', { class: 'soft' }, intro) : null, ...body);

  return h(
    'div',
    { class: 'record-page' },
    h(
      'div',
      { class: 'record-inner' },
      h(
        'header',
        { class: 'record-head' },
        h('div', null, h('p', { class: 'kicker' }, 'Career Plaza'), h('h1', { tabindex: -1 }, 'My growth record'), h('p', { class: 'soft' }, `Built from ${r.attempts.length} ${r.attempts.length === 1 ? 'visit' : 'visits'} to ${r.explored.length} of 4 buildings.`)),
        h('figure', { class: 'record-map' }, careerMapSvg(r.explored), h('figcaption', null, `Career map: ${r.explored.length} of 4 explored`)),
      ),
      section('rs-tried', 'What you tried', null, tried),
      section('rs-enjoyed', 'What you enjoyed', 'Your own ratings, side by side.', enjoyed),
      section(
        'rs-skills',
        'Skills you used',
        'Each skill and the places it showed up.',
        skills,
        transfer.length
          ? h('p', { class: 'insight' }, `${joinList(transfer.map((s) => s.skill))} showed up in more than one building. One skill can work across very different fields.`)
          : null,
      ),
      section('rs-gaps', 'Skills to grow', null, h('ul', { class: 'plain' }, r.gaps.map((g) => h('li', { class: skillClass(g.skill) }, skillGlyph(g.skill), h('span', null, g.text))))),
      section('rs-next', 'Try next', null, h('ul', { class: 'plain next' }, r.tryNext.map((t) => h('li', null, h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'), h('span', null, t))))),
      section('rs-compare', 'Compare the work', 'A side-by-side look at the buildings you tried.', compare),
      h(
        'section',
        { class: 'rsec card actions-sec', 'aria-label': 'Record actions' },
        h('div', { class: 'actions wrap' }, copyBtn, h('button', { class: 'btn primary', type: 'button', onclick: on.onPlaza }, 'Keep exploring'), h('button', { class: 'btn ghost danger', type: 'button', onclick: on.onStartOver }, 'Start over')),
        fallback,
        h('div', { class: 'future' }, h('button', { class: 'btn', type: 'button', disabled: true }, 'Share with a career advisor (coming in the next phase)')),
      ),
      h('footer', { class: 'record-foot' }, "This is a starting point, not a verdict. Real internships and conversations with a career coach add what a game can't."),
    ),
  );
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Top-down silhouette of the plaza with explored buildings lit. */
export function careerMapSvg(explored: ScenarioId[]): SVGElement {
  const pos: Record<ScenarioId, [number, number]> = {
    consulting: [100, 34],
    classroom: [166, 100],
    data: [100, 166],
    research: [34, 100],
  };
  const shapes: Record<ScenarioId, string> = {
    consulting: '<rect x="-13" y="-16" width="26" height="32" rx="2"/>',
    classroom: '<rect x="-14" y="-20" width="28" height="40" rx="2"/>',
    data: '<rect x="-17" y="-13" width="20" height="26" rx="2"/><rect x="0" y="-9" width="17" height="22" rx="2"/>',
    research: '<circle r="17"/>',
  };
  const parts = SCENARIO_IDS.map((id) => {
    const [x, y] = pos[id];
    const lit = explored.includes(id);
    return `<g class="mb ${lit ? 'lit' : ''}" transform="translate(${x} ${y})">${lit ? '<circle class="halo" r="27"/>' : ''}${shapes[id]}</g>`;
  }).join('');
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="map-svg" viewBox="0 0 200 200" role="img" aria-label="Career map with ${explored.length} of 4 buildings lit">
    <circle class="m-plaza" cx="100" cy="100" r="54"/>
    <path class="m-path" d="M100 46V18M154 100h28M100 154v28M46 100H18"/>
    <circle class="m-ring" cx="100" cy="100" r="30"/>
    <circle class="m-fountain" cx="100" cy="100" r="11"/>
    ${parts}
  </svg>`;
  return wrap.firstElementChild as SVGElement;
}

// ---- Clipboard ----------------------------------------------------------------

async function copyText(text: string, btn: HTMLButtonElement, fallback: HTMLElement) {
  const label = btn.textContent;
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
    window.setTimeout(() => (btn.textContent = label), 1800);
  } catch {
    // Clipboard blocked: show the text selected so it can be copied by hand.
    const ta = h('textarea', { class: 'copy-text', rows: 10, readonly: true, 'aria-label': 'Your growth record as text' }) as HTMLTextAreaElement;
    ta.value = text;
    fallback.replaceChildren(h('p', { class: 'soft' }, "Your browser blocked copying. The text is selected below, so press Ctrl+C (or ⌘C) to copy it."), ta);
    fallback.hidden = false;
    ta.focus();
    ta.select();
  }
}

// ---- In-page confirmation ---------------------------------------------------------

function confirmDialog(o: { title: string; body: string; confirm: string; cancel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const close = (v: boolean) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
      resolve(v);
    };
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, o.cancel);
    const ok = h('button', { class: `btn ${o.danger ? 'danger-solid' : 'primary'}`, type: 'button', onclick: () => close(true) }, o.confirm);
    const box = h('div', { class: 'dialog card', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-h', 'aria-describedby': 'dlg-b' }, h('h2', { id: 'dlg-h' }, o.title), h('p', { id: 'dlg-b' }, o.body), h('div', { class: 'actions' }, cancel, ok));
    const overlay = h('div', { class: 'dialog-backdrop', onclick: (e: Event) => e.target === overlay && close(false) }, box);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === cancel ? ok : cancel).focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    cancel.focus();
  });
}
