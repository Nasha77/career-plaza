import { CONTENT, SCENARIO_IDS, getScenario } from '../content';
import type { FeedbackProvider, FeedbackResult } from '../feedback/provider';
import { aiAvailable, aiCoach, aiFollowup, aiSummary } from '../ai/client';
import { AiProvider } from '../feedback/ai';
import { MAX_REVISIONS, coachWriting, type CoachResult } from '../feedback/coach';
import { ScriptedProvider } from '../feedback/scripted';
import { buildRecord, exploredIds, guideLine, joinList, ratingWord, recordAsText, thenAndNow, type GrowthRecord, type ThenAndNow } from '../record';
import { clearState, loadState, saveState } from '../store';
import type { Attempt, ChoiceId, Rating, Resource, SaveState, Scenario, ScenarioId, SelfCheck, SkillName } from '../types';
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

type Screen = 'title' | 'selfcheck' | 'plaza' | 'scenario' | 'record';
type Step = 'intro' | 'choose' | 'write' | 'coach' | 'followup' | 'feedback' | 'reflect' | 'rate' | 'resources';

interface Run {
  scenario: Scenario;
  isRevisit: boolean;
  startedAt: string;
  step: Step;
  choiceId?: ChoiceId;
  written?: string;
  firstDraft?: string;
  revisions: number;
  coach?: CoachResult;
  followupQuestion?: string;
  followupAnswer?: string;
  feedback?: FeedbackResult;
  saved?: boolean;
  /** A reaction to the player's last action, said at the start of the next step. */
  pendingLine?: string;
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
  resort: '#C4462A',
  policy: '#34465E',
  foundation: '#8C3B4A',
  workforce: '#3A4148',
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
  /** True only under `npm run dev` with a key in .env.local. */
  private ai = false;

  constructor(private els: Elements, private opts: AppOptions) {
    this.world = opts.world;
    this.webglFailed = opts.webglFailed;
    this.bindWorld();
    this.world.setVisited(exploredIds(this.save.attempts));
    if (import.meta.env.DEV) {
      void aiAvailable().then((on) => {
        if (!on) return;
        this.ai = true;
        this.provider = new AiProvider();
        this.renderHud();
      });
    }
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
    if (this.screen === 'title' || this.screen === 'selfcheck') return;
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
      this.ai ? h('span', { class: 'ai-badge', title: 'Characters are using the local AI on this computer' }, 'AI on') : null,
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
      h('p', { class: 'pitch' }, 'Try four real internships for a few minutes each. See what you used, what you enjoyed, and where to go next.'),
      h('p', { class: 'promise' }, h('strong', null, 'No scores. No wrong answers.'), ' About 8 to 10 minutes.'),
      this.webglFailed
        ? h('p', { class: 'notice', role: 'note' }, "3D couldn't start on this device, so you'll play in Simple mode. Everything else works the same.")
        : null,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: () => this.startFromTitle() }, hasProgress ? 'Continue exploring' : 'Start'),
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
    this.startFromTitle();
  }

  /** New players get the short self-check first; returning players go straight to the plaza. */
  private startFromTitle() {
    if (!this.save.selfChecks.length && !this.attempts.length) this.showSelfCheck('start');
    else this.showPlaza();
  }

  // ---- Self-check ------------------------------------------------------------

  private showSelfCheck(mode: 'start' | 'retake') {
    this.setScreen('selfcheck');
    this.world.setActive(true);
    const done = (check: SelfCheck | null) => {
      if (check) {
        this.save = { ...this.save, selfChecks: [...this.save.selfChecks, check] };
        saveState(this.save);
      }
      if (mode === 'retake') this.showRecord();
      else this.showPlaza();
    };
    const page = renderSelfCheck(mode, done);
    this.els.stage.replaceChildren(page);
    page.querySelector<HTMLElement>('h1')?.focus();
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
          'aria-label': `${s.building}: ${s.internRole}, with ${s.npc.name}. ${visited ? 'Explored. Enter again for a new twist.' : 'Not explored yet.'}`,
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
          simple ? h('span', { class: 'bdesc' }, `You: ${s.internRole}. Working with ${s.npc.name}, ${s.npc.role}.`) : null,
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
      revisions: 0,
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
    if (this.run.choiceId && !this.run.saved) {
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
        h('span', { class: 'steps', 'aria-label': `Step ${stepIndex(run.step) + 1} of ${STEPS.length}` }, STEPS.map((st) => h('span', { class: `sdot ${stepIndex(st) <= stepIndex(run.step) ? 'on' : ''}` }))),
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
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [h('p', { class: 'role-line' }, h('span', { class: 'k' }, 'Your role: '), s.internRole), h('p', { class: 'setting' }, s.setting), l1, twist, controls])));
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
        const reaction = this.takePending(run);
        const r0 = reaction ? say() : null;
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [r0, findingsCard(run, true), p, controls])));
        void this.speak(r0 && reaction ? [r0, p] : [p], reaction ? [reaction, s.writePrompt] : [s.writePrompt], controls);
        break;
      }
      case 'coach': {
        const c = run.coach!;
        const works = c.whatWorks ? say() : null;
        const tip = say();
        const controls = h(
          'div',
          { class: 'block' },
          findingsCard(run, false),
          h('p', { class: 'label' }, 'What a strong answer does here'),
          h('ul', { class: 'coach-points' }, s.writeGuide.points.map((pt) => h('li', null, pt))),
          h('blockquote', { class: 'sample' }, h('span', { class: 'k' }, 'Your words: '), `“${run.written ?? ''}”`),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => this.reviseAnswer() }, 'Revise my answer'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => this.keepAnswer() }, 'Keep it and continue'),
          ),
        );
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [works, tip, controls])));
        const lines: HTMLElement[] = [];
        const texts: string[] = [];
        if (works && c.whatWorks) {
          lines.push(works);
          texts.push(c.whatWorks);
        }
        lines.push(tip);
        texts.push(c.tip);
        void this.speak(lines, texts, controls);
        break;
      }
      case 'followup': {
        const q = say();
        q.classList.add('question');
        const ta = h('textarea', { id: 'followup', rows: 3, maxlength: 400, placeholder: 'Your reply…', 'aria-labelledby': 'followup-l' }) as HTMLTextAreaElement;
        const controls = h(
          'div',
          { class: 'block' },
          h('label', { id: 'followup-l', class: 'label', for: 'followup' }, `Reply to ${s.npc.name}`),
          ta,
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => void this.answerFollowup(ta.value) }, 'Reply'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => void this.answerFollowup('') }, 'Skip'),
          ),
        );
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [q, findingsCard(run, false), controls])));
        void this.speak([q], [run.followupQuestion ?? ''], controls);
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
        const reaction = this.takePending(run);
        const r0 = reaction ? say() : null;
        stage.replaceChildren(this.wrapScenario(this.dialogueCard(run, [r0, r, ack, chips])));
        const lines: HTMLElement[] = r0 ? [r0, r] : [r];
        const texts = reaction ? [reaction, fb.npcReaction] : [fb.npcReaction];
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
        const reaction = this.takePending(run);
        const r0 = reaction ? say() : null;
        const finish = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => this.finish() }, 'Finish');
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
          r0,
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
        const ratingsBlock = h('div');
        if (r0 && reaction) void this.speak([r0], [reaction], ratingsBlock);
        (card.querySelector('input') as HTMLElement | null)?.focus({ preventScroll: true });
        this.announce(`${reaction ? `${reaction} ` : ''}Rate how much you enjoyed this and how confident you felt.`);
        break;
      }
      case 'resources': {
        const line = say();
        const controls = h(
          'div',
          { class: 'block' },
          resourceList(s.resources, true),
          h('p', { class: 'label' }, 'For any humanities career'),
          resourceList(CONTENT.commonResources, false),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => void this.exitToPlaza() }, 'Back to the plaza')),
        );
        stage.replaceChildren(
          this.wrapScenario(
            this.dialogueCard(run, [h('h2', { class: 'rate-h' }, `Learn more: ${s.internRole}`), line, controls]),
          ),
        );
        const reaction = this.takePending(run);
        const resourcesLine = "If you want to know more about this kind of work, here's where I'd start. These links open in a new tab.";
        void this.speak([line], [reaction ? `${reaction} ${resourcesLine}` : resourcesLine], controls);
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
    this.run.pendingLine = this.run.scenario.options.find((o) => o.id === id)?.chooseLine;
    this.go('write');
  }

  private takePending(run: Run): string | undefined {
    const line = run.pendingLine;
    run.pendingLine = undefined;
    return line;
  }

  private async submitWriting(text: string) {
    const run = this.run;
    if (!run || !run.choiceId) return;
    run.written = text.trim() || undefined;
    if (!run.written) run.pendingLine = run.scenario.reactions.skipWrite;
    if (run.written && run.revisions < MAX_REVISIONS) {
      let c: CoachResult | null = null;
      if (this.ai) {
        this.showThinking(run, `${run.scenario.npc.name} is reading your answer…`);
        c = await aiCoach(run.scenario.id, run.choiceId, run.written);
        if (this.run !== run) return;
      }
      c = c ?? coachWriting(run.scenario, run.written);
      if (c.status === 'could_strengthen') {
        run.coach = c;
        this.go('coach');
        return;
      }
    }
    await this.afterWriting();
  }

  private keepAnswer() {
    if (!this.run) return;
    this.run.pendingLine = this.run.scenario.reactions.keep;
    void this.afterWriting();
  }

  /** With the AI on, the manager asks one follow-up question about what the student wrote. */
  private async afterWriting() {
    const run = this.run;
    if (!run || !run.choiceId) return;
    if (this.ai && run.written && !run.followupQuestion) {
      this.showThinking(run, `${run.scenario.npc.name} is thinking…`);
      const q = await aiFollowup(run.scenario.id, run.choiceId, run.written);
      if (this.run !== run) return;
      if (q) {
        run.followupQuestion = q;
        this.go('followup');
        return;
      }
    }
    await this.toFeedback();
  }

  private async answerFollowup(text: string) {
    const run = this.run;
    if (!run) return;
    run.followupAnswer = text.trim() || undefined;
    await this.toFeedback();
  }

  /** A short "thinking" card while the AI replies, so the student knows something is happening. */
  private showThinking(run: Run, label: string) {
    this.world.setTalking('npc');
    this.announce(label);
    this.els.stage.replaceChildren(
      this.wrapScenario(this.dialogueCard(run, [h('p', { class: 'say thinking', role: 'status' }, label, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')))])),
    );
  }

  /** Revising keeps the first draft so the growth record can show both versions. */
  private reviseAnswer() {
    const run = this.run;
    if (!run) return;
    if (run.firstDraft === undefined) run.firstDraft = run.written;
    run.revisions += 1;
    run.pendingLine = run.scenario.reactions.revise;
    this.go('write');
  }

  private async toFeedback() {
    const run = this.run;
    if (!run || !run.choiceId) return;
    if (this.ai) this.showThinking(run, `${run.scenario.npc.name} is thinking…`);
    const pending = run.pendingLine;
    run.feedback = await this.provider.getFeedback({
      scenarioId: run.scenario.id,
      choiceId: run.choiceId,
      writtenResponse: run.written,
      isRevisit: run.isRevisit,
      twist: run.isRevisit ? run.scenario.twist : undefined,
      followupQuestion: run.followupQuestion,
      followupAnswer: run.followupAnswer,
      earlier: this.attempts.slice(-4).map((a) => {
        const sc = getScenario(a.scenarioId);
        return { building: sc.building, choice: sc.options.find((o) => o.id === a.choiceId)?.text ?? '' };
      }),
    });
    run.pendingLine = pending;
    if (this.run !== run) return;
    // Only praise a revision that now meets the bar, not one the student chose to keep as is.
    const improved = run.written !== undefined && coachWriting(run.scenario, run.written).status === 'solid';
    if (run.revisions > 0 && improved && run.written !== run.firstDraft) {
      run.feedback.acknowledgement = 'Thanks for taking another pass. That reads more clearly.';
    }
    if (this.run === run) this.go('feedback');
  }

  private saveReflection(text: string) {
    if (!this.run) return;
    this.run.reflection = text.trim() || undefined;
    this.run.pendingLine = this.run.reflection ? this.run.scenario.reactions.reflected : this.run.scenario.reactions.skippedReflect;
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

  private finish() {
    const run = this.run;
    if (!run || !run.choiceId || !run.feedback || !run.enjoyment || !run.confidence || this.busy || run.saved) return;
    const attempt: Attempt = {
      id: uid(),
      scenarioId: run.scenario.id,
      startedAt: run.startedAt,
      choiceId: run.choiceId,
      writtenResponse: run.written,
      firstDraft: run.firstDraft !== undefined && run.firstDraft !== run.written ? run.firstDraft : undefined,
      revisions: run.revisions || undefined,
      reflectionNote: run.reflection,
      enjoyment: run.enjoyment,
      confidence: run.confidence,
      wantsMore: run.wantsMore,
      isRevisit: run.isRevisit,
      skills: run.feedback.skills.map((s) => ({ skill: s.skill, weight: s.weight })),
    };
    this.save = { ...this.save, attempts: [...this.attempts, attempt] };
    saveState(this.save);
    run.saved = true;
    const r = run.scenario.reactions;
    const mood = run.enjoyment >= 4 ? r.rateHigh : run.enjoyment <= 2 ? r.rateLow : r.rateMid;
    run.pendingLine = run.wantsMore ? `${mood} ${r.wantsMore}` : mood;
    this.justFinished = attempt.scenarioId;
    this.renderHud();
    this.go('resources');
  }

  // ---- Growth record --------------------------------------------------------

  private showRecord() {
    if (!this.attempts.length) return;
    this.setScreen('record');
    this.world.setActive(false);
    const r = buildRecord(this.attempts);
    const then = thenAndNow(this.attempts, this.save.selfChecks);
    const page = renderRecord(r, then, {
      onCopy: (btn, fallback) => void copyText(recordAsText(r, then), btn, fallback),
      onCheck: () => this.showSelfCheck('retake'),
      onStartOver: () => void this.startOver(),
      onPlaza: () => this.backToPlazaFromRecord(),
    });
    this.els.stage.replaceChildren(page);
    page.scrollTop = 0;
    page.querySelector<HTMLElement>('h1')?.focus();
    if (this.ai) void this.fillSummary(page);
  }

  private async fillSummary(page: HTMLElement) {
    const slot = h('p', { class: 'soft thinking', role: 'status' }, 'Writing your personal summary', h('span', { class: 'dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')));
    const section = h('section', { class: 'rsec card summary', 'aria-labelledby': 'rs-summary' }, h('h2', { id: 'rs-summary' }, 'Your summary'), slot);
    page.querySelector('.record-head')?.after(section);
    const paras = await aiSummary(this.attempts, this.save.selfChecks[0] ?? null);
    if (!paras) {
      section.remove();
      return;
    }
    slot.replaceWith(...paras.map((t) => h('p', null, t)), h('p', { class: 'soft small' }, 'Written by AI from your choices, words and ratings. Read it as a starting point, not a verdict.'));
  }

  private backToPlazaFromRecord() {
    this.showPlaza();
  }

  private async startOver() {
    const ok = await confirmDialog({
      title: 'Start over?',
      body: 'This clears every attempt, rating, note and self-check on this device. It cannot be undone.',
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

const STEPS: Step[] = ['intro', 'choose', 'write', 'feedback', 'reflect', 'rate', 'resources'];
/** Coaching is part of the writing step, so it shares its dot. */
const stepIndex = (s: Step) => STEPS.indexOf(s === 'coach' || s === 'followup' ? 'write' : s);

// ---- Growth record rendering -------------------------------------------------

function renderRecord(
  r: GrowthRecord,
  then: ThenAndNow,
  on: {
    onCopy: (btn: HTMLButtonElement, fallback: HTMLElement) => void;
    onCheck: () => void;
    onStartOver: () => void;
    onPlaza: () => void;
  },
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
        a.firstDraft ? h('blockquote', { class: 'sample draft' }, h('span', { class: 'k' }, 'First draft: '), `“${a.firstDraft}”`) : null,
        a.writtenResponse
          ? h('blockquote', { class: 'sample' }, h('span', { class: 'k' }, a.firstDraft ? 'After revising: ' : 'Your words: '), `“${a.writtenResponse}”`)
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
      section('rs-then', 'Then and now', 'How you saw yourself at the start, next to what happened when you tried the work.', thenAndNowView(then, on.onCheck)),
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
      section('rs-learn', 'Learn more about these roles', 'Links open in a new tab.', learnMore(r.explored)),
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
    resort: [100, 34],
    policy: [166, 100],
    foundation: [100, 166],
    workforce: [34, 100],
  };
  const shapes: Record<ScenarioId, string> = {
    resort: '<rect x="-13" y="-16" width="26" height="32" rx="2"/>',
    policy: '<rect x="-14" y="-20" width="28" height="40" rx="2"/>',
    foundation: '<rect x="-17" y="-13" width="20" height="26" rx="2"/><rect x="0" y="-9" width="17" height="22" rx="2"/>',
    workforce: '<circle r="17"/>',
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

// ---- Resources ----------------------------------------------------------------

function resourceList(items: Resource[], primary: boolean): HTMLElement {
  return h(
    'ul',
    { class: `resources ${primary ? '' : 'secondary'}` },
    items.map((res) =>
      h(
        'li',
        null,
        h(
          'a',
          { href: res.url, target: '_blank', rel: 'noopener noreferrer', class: 'res-link' },
          h('span', { class: 'res-title' }, res.title),
          h('span', { class: 'sr-only' }, ' (opens in a new tab)'),
          h('span', { class: 'res-arrow', 'aria-hidden': 'true' }, '↗'),
        ),
        h('span', { class: 'res-why' }, res.why),
      ),
    ),
  );
}

function learnMore(explored: ScenarioId[]): HTMLElement {
  return h(
    'div',
    { class: 'learn' },
    explored.map((id) => {
      const s = getScenario(id);
      return h(
        'div',
        { class: 'learn-role' },
        h('h3', null, h('span', { class: `bicon-wrap b-${id}` }, buildingIcon(id)), h('span', null, s.internRole, h('span', { class: 'soft' }, ` · ${s.building}`))),
        resourceList(s.resources, true),
      );
    }),
    h('div', { class: 'learn-role' }, h('h3', null, 'For any humanities career'), resourceList(CONTENT.commonResources, false)),
  );
}

// ---- Then and now ---------------------------------------------------------------

function thenAndNowView(t: ThenAndNow, onCheck: () => void): HTMLElement {
  const name = (id: ScenarioId) => getScenario(id).building;
  const fieldLabel = (id: ScenarioId) => CONTENT.selfCheck.fieldPick.options.find((o) => o.scenario === id)?.label ?? name(id);
  const dots = (v: number | undefined, label: string, empty: string) =>
    v === undefined ? h('span', { class: 'soft small' }, empty) : ratingDots(v, `${label} ${ratingWord(v)}`);

  if (!t.start) {
    return h(
      'div',
      { class: 'then-empty' },
      h('p', null, 'You skipped the start check. Take it now to compare how you see yourself with what you did in each building.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: onCheck }, 'Take the check')),
    );
  }

  const goodAt = h(
    'div',
    { class: 'table-wrap', tabindex: 0, role: 'region', 'aria-label': 'Skills: expected and in practice' },
    h(
      'table',
      { class: 'compare then-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { scope: 'col' }, 'Skill'),
          h('th', { scope: 'col' }, 'You expected'),
          h('th', { scope: 'col' }, 'In practice'),
          t.retaken ? h('th', { scope: 'col' }, 'Now you say') : null,
        ),
      ),
      h(
        'tbody',
        null,
        t.skills.map((s) =>
          h(
            'tr',
            { class: skillClass(s.skill) },
            h('th', { scope: 'row' }, h('span', { class: 'skill-name' }, skillGlyph(s.skill), s.skill)),
            h('td', null, dots(s.expected, 'Expected confidence', 'Not rated')),
            h('td', null, dots(s.practice, 'Confidence in practice', 'Not used yet')),
            t.retaken ? h('td', null, dots(s.now, 'Confidence now', 'Not rated')) : null,
          ),
        ),
      ),
    ),
  );

  const expected = [...t.expectedSkills.map((sk) => skillChip(sk)), t.expectedField ? h('span', { class: 'chip field' }, fieldLabel(t.expectedField)) : null].filter(Boolean) as HTMLElement[];
  const enjoyed = [...t.enjoyedSkills.map((sk) => skillChip(sk)), t.enjoyedBuilding ? h('span', { class: 'chip field' }, name(t.enjoyedBuilding)) : null].filter(Boolean) as HTMLElement[];

  const interests = h(
    'div',
    { class: 'then-interests' },
    h('div', null, h('p', { class: 'label' }, 'You expected to enjoy'), expected.length ? h('div', { class: 'chips' }, expected) : h('p', { class: 'soft' }, 'No picks made.')),
    h('div', null, h('p', { class: 'label' }, 'In practice you enjoyed'), enjoyed.length ? h('div', { class: 'chips' }, enjoyed) : h('p', { class: 'soft' }, 'Finish a building to see this.')),
  );

  return h(
    'div',
    { class: 'then' },
    h('h3', null, "What you're good at"),
    h('p', { class: 'soft' }, 'Your start self-rating next to how confident you felt when the work used each skill.'),
    goodAt,
    h('h3', null, "What you're interested in"),
    interests,
    t.noticed.length
      ? h('div', { class: 'noticed' }, h('p', { class: 'label' }, 'What you might notice'), h('ul', { class: 'plain next' }, t.noticed.map((n) => h('li', null, h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'), h('span', null, n)))))
      : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: onCheck }, 'Take the check again')),
  );
}

// ---- Self-check page ---------------------------------------------------------------

function renderSelfCheck(mode: 'start' | 'retake', done: (check: SelfCheck | null) => void): HTMLElement {
  const c = CONTENT.selfCheck;
  const confidence: Partial<Record<SkillName, Rating>> = {};
  const picks: (SkillName | null)[] = c.skillPicks.map(() => null);
  let field: ScenarioId | null = null;

  const save = h('button', { class: 'btn primary', type: 'button', disabled: true }, mode === 'start' ? 'Save and start exploring' : 'Save my answers') as HTMLButtonElement;
  const hint = h('p', { class: 'hint' }, 'Rate all four statements to continue. The picks are optional.');
  const update = () => {
    const ready = c.confidence.every((q) => confidence[q.skill]);
    save.disabled = !ready;
    hint.hidden = ready;
  };
  save.addEventListener('click', () =>
    done({
      takenAt: new Date().toISOString(),
      confidence,
      skillPicks: picks.filter((p): p is SkillName => p !== null),
      field,
    }),
  );

  const confidenceSets = c.confidence.map((q, i) =>
    h(
      'fieldset',
      { class: 'scale' },
      h('legend', null, h('span', { class: `skill-name ${skillClass(q.skill)}` }, skillGlyph(q.skill)), ` ${q.statement}`),
      h(
        'div',
        { class: 'scale-row' },
        [1, 2, 3, 4, 5].map((n) =>
          h(
            'label',
            { class: 'pill' },
            h('input', {
              type: 'radio',
              name: `conf-${i}`,
              value: n,
              onchange: () => {
                confidence[q.skill] = n as Rating;
                update();
              },
            }),
            h('span', null, String(n)),
          ),
        ),
      ),
      h('div', { class: 'scale-ends', 'aria-hidden': 'true' }, h('span', null, '1 not yet'), h('span', null, '5 very')),
    ),
  );

  const choiceSet = <T,>(name: string, legend: string, options: { value: T; label: string }[], onPick: (v: T) => void) =>
    h(
      'fieldset',
      { class: 'scale' },
      h('legend', null, legend),
      h(
        'div',
        { class: 'choice-row' },
        options.map((o) =>
          h('label', { class: 'pill text' }, h('input', { type: 'radio', name, onchange: () => onPick(o.value) }), h('span', null, o.label)),
        ),
      ),
    );

  const pickSets = c.skillPicks.map((q, i) =>
    choiceSet(`pick-${i}`, q.question, q.options.map((o) => ({ value: o.skill, label: o.label })), (v) => (picks[i] = v)),
  );
  const fieldSet = choiceSet('field', c.fieldPick.question, c.fieldPick.options.map((o) => ({ value: o.scenario, label: o.label })), (v) => (field = v));

  const card = h(
    'section',
    { class: 'selfcheck-card card', 'aria-labelledby': 'sc-h' },
    h('p', { class: 'kicker' }, mode === 'start' ? 'Before you explore' : 'Take the check again'),
    h('h1', { id: 'sc-h', tabindex: -1 }, 'Where do you stand?'),
    h('p', { class: 'soft' }, c.intro),
    h('h2', { class: 'label' }, 'How confident are you?'),
    confidenceSets,
    h('h2', { class: 'label' }, 'What draws you?'),
    pickSets,
    fieldSet,
    hint,
    h(
      'div',
      { class: 'actions' },
      save,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => done(null) }, mode === 'start' ? 'Skip for now' : 'Cancel'),
    ),
  );
  update();
  return h('div', { class: 'selfcheck-wrap' }, card);
}

// ---- Findings: what the student's chosen approach turned up ---------------------------

function findingsCard(run: { scenario: Scenario; choiceId?: ChoiceId }, open: boolean): HTMLElement | null {
  const option = run.scenario.options.find((o) => o.id === run.choiceId);
  if (!option) return null;
  const f = option.result;
  let body: HTMLElement;
  if (f.kind === 'table') {
    body = h(
      'table',
      { class: 'find-table' },
      h('tbody', null, (f.rows ?? []).map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v)))),
    );
  } else if (f.kind === 'list') {
    body = h('ol', { class: 'find-list' }, (f.items ?? []).map((i) => h('li', null, i)));
  } else {
    body = h('ul', { class: 'find-notes' }, (f.items ?? []).map((i) => h('li', null, i)));
  }
  return h(
    'details',
    { class: 'findings', open },
    h('summary', null, h('span', { class: 'find-kicker' }, 'What you found'), h('span', { class: 'find-title' }, f.title)),
    body,
    f.note ? h('p', { class: 'find-note' }, h('strong', null, 'Worth noticing: '), f.note) : null,
    h('p', { class: 'find-foot' }, 'Practice data: the names and figures are made up.'),
  );
}
