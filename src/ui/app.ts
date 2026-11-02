import { CONTENT, SCENARIO_IDS, getScenario, getTask, taskCount, taskManagerIndex } from '../content';
import type { FeedbackProvider, FeedbackResult } from '../feedback/provider';
import { aiAvailable, aiCoach, aiFollowup, aiSummary } from '../ai/client';
import { chime, isMuted, setMuted, unlockAudio, voiceFor, type Voice } from '../audio/voice';
import { AiProvider } from '../feedback/ai';
import { MAX_REVISIONS, coachWriting, type CoachResult } from '../feedback/coach';
import { ScriptedProvider } from '../feedback/scripted';
import { buildRecord, exploredIds, guideLine, joinList, ratingWord, recordAsText, thenAndNow, type GrowthRecord, type ThenAndNow } from '../record';
import { clearState, loadState, saveState } from '../store';
import type { Attempt, ChatLine, ChoiceId, Rating, Resource, SaveState, Scenario, ScenarioId, SelfCheck, SkillName, TaskIndex } from '../types';
import { PLAYER_LOOKS, castFor } from '../world/cast';
import { reducedMotion, type Marker, type ThingId, type World } from '../world/types';
import { portraitFor, preparePortraits } from './portraits';
import { Talk, type Speaker } from './talk';
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
/** `brief` is roaming before talking to the manager; `look` is going to see the findings; `done` is roaming after. */
type Step = 'brief' | 'intro' | 'choose' | 'look' | 'write' | 'coach' | 'followup' | 'feedback' | 'reflect' | 'studies' | 'rate' | 'resources' | 'done';

interface Run {
  scenario: Scenario;
  taskIndex: TaskIndex;
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
  studyNote?: string;
  reflection?: string;
  enjoyment?: Rating;
  confidence?: Rating;
  wantsMore: boolean;
  /** After the findings card, walk back to the manager once the conversation closes. */
  backToManager?: boolean;
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

/** Each manager's babble voice: bright and quick, low and even, and so on. Others get one from their name. */
const VOICES: Record<string, Partial<Voice>> = {
  Priya: { pitch: 470, wave: 'triangle', range: 0.45 },
  Daniel: { pitch: 210, wave: 'sine', range: 0.15 },
  Grace: { pitch: 360, wave: 'sine', range: 0.25 },
  Marcus: { pitch: 250, wave: 'square', range: 0.3 },
  'Wei Ling': { pitch: 420, wave: 'square', range: 0.25 },
  Kenji: { pitch: 290, wave: 'triangle', range: 0.35 },
  Rachel: { pitch: 390, wave: 'sine', range: 0.2 },
  Nadia: { pitch: 340, wave: 'triangle', range: 0.3 },
};

const LOOK_KEY = 'careerPlaza.look';

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
  private talk: Talk;
  /** The player's chosen character. */
  private look = (() => {
    try {
      const v = localStorage.getItem(LOOK_KEY);
      if (v && PLAYER_LOOKS.includes(v)) return v;
    } catch {
      /* ignore */
    }
    return PLAYER_LOOKS[0];
  })();
  /** Inside a conversation (the player can't walk), and inside the task's panels with the manager. */
  private conversing = false;
  private inPanel = false;
  /** Who is speaking in the talk box, for the talking bounce and emotes. */
  private talkWith: ThingId | null = null;
  private walkedOnce = false;

  constructor(private els: Elements, private opts: AppOptions) {
    this.world = opts.world;
    this.webglFailed = opts.webglFailed;
    this.talk = new Talk({
      onSpeak: (talking, mood) => {
        const who = this.talkWith;
        this.world.setTalking(talking && who ? who : null);
        if (mood && who) this.world.emote(who, mood);
      },
      announce: (t) => this.announce(t),
    });
    // Sound can only start after the first click or key press.
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    this.bindWorld();
    this.world.setVisited(exploredIds(this.save.attempts));
    if (__AI_ROUTES__) {
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
    this.world.setPlayerLook(this.look);
    this.world.onPick = (id) => {
      if (this.screen === 'plaza') this.pickRole(id);
    };
    this.world.onThing = (id) => {
      if (this.screen === 'scenario' && this.run) void this.useThing(id);
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
    const sound = h(
      'button',
      {
        class: 'btn small ghost sound-btn',
        type: 'button',
        'aria-pressed': String(!isMuted()),
        title: isMuted() ? 'Voices are off' : 'Voices are on',
        onclick: () => {
          setMuted(!isMuted());
          unlockAudio();
          this.renderHud();
        },
      },
      h('span', { 'aria-hidden': 'true' }, isMuted() ? '🔇' : '🔊'),
      h('span', { class: 'sr-only' }, 'Character voices'),
    );
    hud.append(left, map, h('div', { class: 'hud-right' }, sound, right));
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
      this.lookPicker(),
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

  /** Pick who you walk around as. Remembered on this device. */
  private lookPicker(): HTMLElement | null {
    if (this.world.mode !== '3d') return null;
    const base = `${import.meta.env.BASE_URL}models/characters/previews/`;
    return h(
      'fieldset',
      { class: 'look-pick' },
      h('legend', { class: 'label' }, 'Choose your character'),
      h(
        'div',
        { class: 'look-row' },
        PLAYER_LOOKS.map((look, i) =>
          h(
            'label',
            { class: 'look-opt' },
            h('input', {
              type: 'radio',
              name: 'look',
              value: look,
              checked: this.look === look,
              onchange: () => {
                this.look = look;
                this.world.setPlayerLook(look);
                try {
                  localStorage.setItem(LOOK_KEY, look);
                } catch {
                  /* ignore */
                }
              },
            }),
            h('img', { src: `${base}${look}.png`, alt: `Character ${i + 1}`, width: 48, height: 48 }),
          ),
        ),
      ),
    );
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
      const roles = taskCount(id);
      const tried = rolesTried(this.attempts, id);
      const inside = `${tried} of ${roles} roles tried`;
      return h(
        'button',
        {
          class: `bbtn b-${id} ${visited ? 'visited' : ''}`,
          type: 'button',
          'data-id': id,
          'aria-label': `${s.building}: ${roles} roles to choose from. ${visited ? `Explored, ${inside}.` : 'Not explored yet.'}`,
          onclick: () => this.pickRole(id),
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
          simple ? h('span', { class: 'bdesc' }, `${roles} roles: ${[0, 1].slice(0, roles).map((t) => getTask(id, t as TaskIndex).internRole).join(' or ')}.`) : null,
          h('span', { class: 'bstatus' }, visited ? `✓ ${inside}` : `New · ${roles} roles`),
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
  //
  // Inside a building the player walks around (Pokemon-style) and talks to people in the
  // Animal Crossing-style talk box. The task moves on when they talk to the manager:
  //   brief (roam) -> intro chat -> choose an approach -> walk there, see the findings ("look")
  //   -> back to the manager: write -> feedback -> reflect -> studies -> rate -> resources -> done (roam)

  /**
   * Before going in, the player picks which of the building's roles to try. Each card says who
   * they'd work with, what the job is, and whether they've tried it (a second go brings a twist).
   */
  private pickRole(id: ScenarioId) {
    if (this.busy || this.screen !== 'plaza') return;
    if (taskCount(id) < 2) return void this.enterBuilding(id, 0);
    this.els.stage.querySelector('.role-pick-wrap')?.remove();
    const s0 = getScenario(id);
    const prev = document.activeElement as HTMLElement | null;
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      this.world.setHover(null);
      prev?.focus?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const cards = ([0, 1] as TaskIndex[]).map((t) => {
      const task = getTask(id, t);
      const tries = this.attempts.filter((a) => a.scenarioId === id && (a.taskIndex ?? 0) === t).length;
      const color = managerColor({ scenario: task, taskIndex: t });
      return h(
        'button',
        {
          class: `role-option ${tries ? 'tried' : ''}`,
          type: 'button',
          onclick: () => {
            close();
            void this.enterBuilding(id, t);
          },
        },
        h('span', { class: 'role-tag', style: `--c:${color}` }, tries ? `✓ Tried · new twist next` : 'New'),
        h('strong', { class: 'role-name' }, task.internRole),
        h('span', { class: 'role-with' }, `With ${task.npc.name}, ${task.npc.role}`),
        h('span', { class: 'role-brief' }, task.brief),
      );
    });
    const card = h(
      'section',
      { class: 'role-pick card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'role-pick-h' },
      h('p', { class: 'kicker' }, s0.building),
      h('h2', { id: 'role-pick-h' }, 'Which role would you like to try?'),
      h('p', { class: 'soft' }, 'Both happen in the same building, with different people. You can come back for the other one any time.'),
      h('div', { class: 'role-options' }, cards),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Not now')),
    );
    const wrap = h('div', { class: 'role-pick-wrap', onclick: (e: Event) => e.target === wrap && close() }, card);
    document.addEventListener('keydown', onKey, true);
    this.els.stage.append(wrap);
    this.world.setHover(id);
    this.announce(`${s0.building}: choose a role.`);
    card.querySelector<HTMLElement>('.role-option')?.focus();
  }

  private async enterBuilding(id: ScenarioId, taskIndex: TaskIndex) {
    if (this.busy) return;
    this.busy = true;
    const scenario = getTask(id, taskIndex);
    const isRevisit = this.attempts.some((a) => a.scenarioId === id && (a.taskIndex ?? 0) === taskIndex);
    this.resetTalk();
    this.run = {
      scenario,
      taskIndex,
      isRevisit,
      startedAt: new Date().toISOString(),
      step: 'brief',
      revisions: 0,
      wantsMore: false,
    };
    this.world.setHover(null);
    this.world.setTalking(null);
    this.els.stage.replaceChildren();
    const cast = castFor(this.look).rooms[id];
    void preparePortraits([cast.manager, ...cast.colleagues]);
    try {
      await this.world.enter(id, { task: taskIndex, twist: isRevisit, look: this.look }, () => {
        this.setScreen('scenario');
        this.renderRoom();
      });
    } catch (err) {
      console.error(err);
      this.run = null;
      this.showPlaza();
      return;
    } finally {
      this.busy = false;
    }
    if (this.run?.scenario.id !== id) return;
    this.refreshRoom();
    this.world.setFree(true);
    this.world.emote('manager', 'excited');
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

  /** Forget any conversation in progress (leaving mid-conversation must not block the next visit). */
  private resetTalk() {
    this.conversing = false;
    this.inPanel = false;
    this.talkWith = null;
    this.talk.hide();
  }

  private async exitToPlaza() {
    this.busy = true;
    this.run = null;
    this.resetTalk();
    this.talk.hide();
    this.world.setTalking(null);
    this.world.setFree(false);
    this.els.floats.replaceChildren();
    try {
      await this.world.exit(() => this.showPlaza());
    } finally {
      this.busy = false;
    }
  }

  // ---- The room: banner, things list and talk box ----

  /** The people and things in the room, with what clicking them does. */
  private things(run: Run): { id: ThingId; label: string; kind: 'person' | 'spot' | 'look' }[] {
    const s = run.scenario;
    const manager = taskManagerIndex(s.id, run.taskIndex);
    const out: { id: ThingId; label: string; kind: 'person' | 'spot' | 'look' }[] = [{ id: 'manager', label: `Talk to ${s.npc.name}`, kind: 'person' }];
    s.colleagues.forEach((c, i) => {
      if (i !== manager) out.push({ id: `person:${i}`, label: `Talk to ${c.name}`, kind: 'person' });
    });
    s.extras.forEach((e, i) => out.push({ id: `extra:${i}`, label: e.busy ? `${e.name} (${e.role}, busy)` : `Chat with ${e.name} (${e.role})`, kind: 'person' }));
    s.options.forEach((o) => out.push({ id: `spot:${o.id}`, label: o.spot, kind: 'spot' }));
    Object.entries(s.examine).forEach(([k, v]) => out.push({ id: `spot:${k}`, label: v.label, kind: 'look' }));
    return out;
  }

  /** The banner along the top, the talk box along the bottom; the room stays visible between them. */
  private renderRoom() {
    const run = this.run;
    if (!run) return;
    const s = run.scenario;
    const objective = h('p', { class: 'objective', role: 'status' });
    const list = h('div', { class: 'things-list', hidden: this.world.mode !== 'simple', id: 'things' });
    const toggle = h(
      'button',
      {
        class: 'btn small things-btn',
        type: 'button',
        'aria-controls': 'things',
        'aria-expanded': String(this.world.mode === 'simple'),
        onclick: () => {
          list.hidden = !list.hidden;
          toggle.setAttribute('aria-expanded', String(!list.hidden));
          if (!list.hidden) list.querySelector<HTMLElement>('button')?.focus();
        },
      },
      'Things here',
    );
    const banner = h(
      'section',
      { class: 'room-banner card', 'aria-label': 'Your role' },
      h(
        'div',
        { class: 'rb-head' },
        h('span', { class: `bicon-wrap b-${s.id}` }, buildingIcon(s.id)),
        h('div', { class: 'rb-text' }, h('strong', null, s.internRole), h('span', { class: 'soft small' }, `${s.building} · with ${s.npc.name}${run.isRevisit ? ' · something new this time' : ''}`)),
        h('span', { class: 'steps', 'aria-hidden': 'true' }),
        toggle,
      ),
      objective,
      list,
    );
    this.els.stage.replaceChildren(h('div', { class: 'room-ui' }, banner), this.talk.el);
    this.refreshRoom();
  }

  /** Update the objective line, step dots, markers, labels and things list for the current step. */
  private refreshRoom() {
    const run = this.run;
    if (!run || this.screen !== 'scenario') return;
    const s = run.scenario;
    const stage = this.els.stage;
    const simple = this.world.mode === 'simple';
    const name = s.npc.name;
    const option = s.options.find((o) => o.id === run.choiceId);
    const goal: Record<Step, string> = {
      brief: simple ? `Talk to ${name} to find out what needs doing.` : `Walk over to ${name} (marked !) to find out what needs doing.`,
      intro: `Talking with ${name}.`,
      choose: simple ? 'Pick where to start from the list.' : `Pick where to start: walk to a marked spot (A, B or C), or ask ${name}.`,
      look: option ? `Take what you found back to ${name}.` : 'Have a look.',
      write: `Working with ${name}.`,
      coach: `Working with ${name}.`,
      followup: `Working with ${name}.`,
      feedback: `Working with ${name}.`,
      reflect: `Working with ${name}.`,
      studies: `Working with ${name}.`,
      rate: `Working with ${name}.`,
      resources: `Working with ${name}.`,
      done: 'All done here. Look around, talk to anyone, or head back to the plaza.',
    };
    const objective = stage.querySelector<HTMLElement>('.objective');
    if (objective) {
      const hint = !simple && run.step === 'brief' && !this.walkedOnce ? ' Click or tap the floor to walk. Arrow keys or WASD work too, and E talks.' : '';
      objective.textContent = goal[run.step] + hint;
    }
    const dots = stage.querySelector<HTMLElement>('.room-banner .steps');
    if (dots) {
      dots.replaceChildren(...STEPS.map((st) => h('span', { class: `sdot ${stepIndex(st) <= stepIndex(run.step) ? 'on' : ''}` })));
      dots.setAttribute('aria-label', `Step ${Math.min(STEPS.length, stepIndex(run.step) + 1)} of ${STEPS.length}`);
    }

    // Markers: "!" on whoever moves the task on, letters on the approach spots while choosing.
    const marks: Partial<Record<ThingId, Marker>> = {};
    if (run.step === 'brief' || (run.step === 'look' && run.choiceId)) marks.manager = '!';
    if (run.step === 'choose') s.options.forEach((o) => (marks[`spot:${o.id}`] = o.id));
    this.world.mark(marks);

    const things = this.things(run);
    const labels: Partial<Record<ThingId, string>> = {};
    things.forEach((t) => (labels[t.id] = t.label));
    this.world.setLabels(labels);

    const list = stage.querySelector<HTMLElement>('.things-list');
    if (list) {
      const group = (title: string, items: typeof things) =>
        items.length
          ? h(
              'div',
              { class: 'things-group' },
              h('p', { class: 'label' }, title),
              h(
                'div',
                { class: 'things-row' },
                items.map((t) =>
                  h(
                    'button',
                    {
                      class: `thing-btn ${marks[t.id] ? 'marked' : ''}`,
                      type: 'button',
                      onclick: () => {
                        if (!simple) list.hidden = true;
                        stage.querySelector('.things-btn')?.setAttribute('aria-expanded', String(!list.hidden));
                        void this.useThing(t.id, true);
                      },
                    },
                    marks[t.id] ? h('span', { class: 'mark', 'aria-hidden': 'true' }, marks[t.id]!) : null,
                    t.label,
                  ),
                ),
              ),
            )
          : null;
      const groups = [
        group('People', things.filter((t) => t.kind === 'person')),
        group('Where to start', things.filter((t) => t.kind === 'spot')),
        group('Look around', things.filter((t) => t.kind === 'look')),
      ];
      list.replaceChildren(...groups.filter((x): x is HTMLDivElement => x !== null));
    }
  }

  /** Someone or something was picked, by clicking in the room or from the list. */
  private async useThing(id: ThingId, walk = false) {
    const run = this.run;
    if (!run || this.conversing || this.busy) return;
    this.walkedOnce = true;
    if (walk) {
      this.world.setFree(false);
      await this.world.goTo(id);
      if (this.run !== run) return;
    }
    if (id === 'manager') return this.converse(run, 'manager', () => this.talkToManager(run));
    if (id.startsWith('person:')) return this.converse(run, id, () => this.talkToColleague(run, Number(id.slice(7))));
    if (id.startsWith('extra:')) return this.converse(run, id, () => this.talkToExtra(run, id));
    const key = id.slice(5);
    if (['A', 'B', 'C'].includes(key)) return this.converse(run, null, () => this.atApproachSpot(run, key as ChoiceId));
    return this.converse(run, null, () => this.examine(run, key));
  }

  /**
   * Hold the player still, frame the conversation, run it, then let them walk again.
   * `who` null is looking at something (no two-shot).
   */
  private async converse(run: Run, who: ThingId | null, body: () => Promise<void>) {
    this.conversing = true;
    this.world.setFree(false);
    this.world.focus(who);
    this.talkWith = who;
    try {
      await body();
    } finally {
      if (this.run === run && !this.inPanel) {
        this.talk.hide();
        this.world.focus(null);
        this.world.setTalking(null);
        this.talkWith = null;
        this.conversing = false;
        this.world.setFree(true);
        this.refreshRoom();
        if (run.backToManager) {
          run.backToManager = false;
          void this.useThing('manager', true);
        }
      }
    }
  }

  /** The speaker for the talk box: name tag colour, portrait and voice. */
  private speaker(run: Run, who: ThingId): Speaker {
    const s = run.scenario;
    const cast = castFor(this.look).rooms[s.id];
    const portrait = portraitFor;
    if (who === 'manager') {
      const m = taskManagerIndex(s.id, run.taskIndex);
      const look = m === null ? cast.manager : cast.colleagues[m];
      return { name: s.npc.name, color: managerColor(run), portrait: portrait(look), voice: voiceFor(s.npc.name, VOICES[s.npc.name]) };
    }
    if (who.startsWith('extra:')) {
      const e = s.extras[Number(who.slice(6))];
      return { name: e?.name ?? '', color: '#8a7357', voice: voiceFor(e?.name ?? 'extra') };
    }
    const i = Number(who.slice(7));
    const c = s.colleagues[i];
    return { name: c.name, color: personColor(s.id, i), portrait: portrait(cast.colleagues[i]), voice: voiceFor(c.name, VOICES[c.name]) };
  }

  private say(run: Run, who: ThingId | null, line: string, controls?: HTMLElement | null) {
    this.talkWith = who;
    return this.talk.say(who ? this.speaker(run, who) : null, line, { controls });
  }

  private async talkToManager(run: Run) {
    switch (run.step) {
      case 'brief':
        return this.introChat(run);
      case 'choose':
        return this.askApproach(run);
      case 'look':
        if (run.choiceId) return this.startWork(run);
        return this.askApproach(run);
      case 'done': {
        const r = run.scenario.reactions;
        await this.say(run, 'manager', `[happy] ${r.wantsMore}`);
        return;
      }
      default:
        return;
    }
  }

  /** The intro as a conversation: the manager's lines, the student's reply bubbles, and the twist. */
  private async introChat(run: Run) {
    run.step = 'intro';
    this.refreshRoom();
    const lines: (ChatLine & { twist?: boolean })[] = [...run.scenario.chat];
    if (run.isRevisit) lines.push({ npc: `[surprised] ${run.scenario.twistLine}`, twist: true });
    for (const line of lines) {
      if (this.run !== run) return;
      if ('npc' in line) {
        if (line.twist) {
          // Everyone looks up at the news.
          run.scenario.colleagues.forEach((_, i) => this.world.emote(`person:${i}`, 'surprised'));
        }
        await this.say(run, 'manager', line.npc);
      } else {
        await this.talk.choose([line.you]);
      }
    }
    if (this.run !== run) return;
    run.step = 'choose';
    await this.askApproach(run);
  }

  /** "Where would you start?": the three approaches as reply bubbles, plus looking around first. */
  private async askApproach(run: Run) {
    run.step = 'choose';
    this.refreshRoom();
    const s = run.scenario;
    await this.say(run, 'manager', `[thinking] ${s.question}`);
    if (this.run !== run) return;
    const pick = await this.talk.choose([...s.options.map((o) => `${o.id}. ${o.text}`), 'Let me look around first.']);
    if (this.run !== run) return;
    if (pick === s.options.length) {
      await this.say(run, 'manager', `[happy] Sure, take your time. I've marked the places to start: A, B and C. Come back if you want to talk it through.`);
      return;
    }
    await this.chooseApproach(run, s.options[pick].id);
  }

  /** Walking up to an approach spot. Before the intro it's a hint; while choosing, it's a choice. */
  private async atApproachSpot(run: Run, id: ChoiceId) {
    const s = run.scenario;
    const o = s.options.find((x) => x.id === id)!;
    this.world.act('player', 'look');
    if (run.step === 'brief' || run.step === 'intro') {
      await this.say(run, null, `${o.spot}. Maybe check in with *${s.npc.name}* first to find out what needs doing.`);
      return;
    }
    if (run.step === 'choose') {
      await this.say(run, null, `${o.spot}. Start here? *${o.text}*`);
      const yes = (await this.talk.choose(['Start here', 'Not yet'])) === 0;
      if (yes && this.run === run) await this.chooseApproach(run, id, true);
      return;
    }
    if (run.choiceId === id) {
      await this.say(run, null, `${o.spot}. This is where you started.`);
      return this.showFindings(run);
    }
    await this.say(run, null, `${o.spot}. You've already started somewhere else this time. You could try it next time.`);
  }

  /** The approach is picked: the manager reacts, the player walks there and finds something. */
  private async chooseApproach(run: Run, id: ChoiceId, alreadyThere = false) {
    const o = run.scenario.options.find((x) => x.id === id);
    if (!o) return;
    run.choiceId = id;
    run.step = 'look';
    this.refreshRoom();
    if (!alreadyThere) {
      this.world.act('manager', 'nod');
      await this.say(run, 'manager', o.chooseLine);
      if (this.run !== run) return;
      this.talk.hide();
      this.world.focus(null);
      await this.world.goTo(`spot:${id}`);
      if (this.run !== run) return;
    }
    this.world.act('player', 'look');
    await this.say(run, null, `You get stuck in: ${o.text.charAt(0).toLowerCase()}${o.text.slice(1)}`);
    if (this.run !== run) return;
    await this.showFindings(run);
  }

  /** The "you found something!" card, held up to the camera like Animal Crossing's "I got…". */
  private showFindings(run: Run): Promise<void> {
    const card = findingsCard(run, true);
    if (!card) return Promise.resolve();
    chime();
    this.world.emote('player', 'idea');
    this.world.act('player', 'pickup');
    return new Promise((resolve) => {
      const go = h('button', { class: 'btn primary', type: 'button' }, `Take it to ${run.scenario.npc.name}`);
      const wrap = h(
        'div',
        { class: 'found-wrap' },
        h('section', { class: 'found card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'What you found' }, h('p', { class: 'found-kicker' }, 'You found something!'), card, h('div', { class: 'actions' }, go)),
      );
      go.addEventListener('click', () => {
        wrap.remove();
        // Once this conversation closes, walk back to the manager and carry on.
        run.backToManager = true;
        resolve();
      });
      this.els.stage.append(wrap);
      this.announce('You found something. ' + (card.textContent ?? ''));
      go.focus();
    });
  }

  /** Back with the manager after looking: the writing and the rest of the task happen in the talk box. */
  private async startWork(run: Run) {
    this.inPanel = true;
    run.pendingLine = `[excited] Ooh, what did you find? Show me!`;
    this.go('write');
  }

  /** A background person: a quick question for you (or they're busy), then you can ask about their work. */
  private async talkToExtra(run: Run, id: ThingId) {
    const e = run.scenario.extras[Number(id.slice(6))];
    if (!e) return;
    if (e.busy) {
      this.world.emote(id, 'thinking');
      await this.say(run, null, `${e.name} is busy ${e.busy}. Best not to bother them right now.`);
      return;
    }
    this.world.emote(id, 'happy');
    if (e.ask && e.choices) {
      await this.say(run, id, `[thinking] ${e.ask}`);
      if (this.run !== run) return;
      const k = await this.talk.choose(e.choices.map((c) => c.text));
      if (this.run !== run) return;
      await this.say(run, id, e.choices[k].reply);
    } else if (e.ask) {
      const answered = await this.openQuestion(run, id, e.ask);
      if (this.run !== run) return;
      await this.say(run, id, answered ? `[happy] ${e.reply ?? 'Thanks!'}` : 'No worries! Have a think and come back.');
    }
    if (this.run !== run) return;
    const more = await this.talk.choose(['What are you working on?', 'See you around!']);
    if (more === 0 && this.run === run) await this.say(run, id, e.line);
  }

  /** An open question in the talk box, with a box to type in. Resolves true if they answered. */
  private openQuestion(run: Run, id: ThingId, question: string): Promise<boolean> {
    return new Promise((resolve) => {
      const ta = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Your answer…', 'aria-label': 'Your answer' }) as HTMLTextAreaElement;
      const done = (answered: boolean) => resolve(answered && ta.value.trim().length > 0);
      const controls = h(
        'div',
        { class: 'block' },
        ta,
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => done(true) }, 'Reply'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => done(false) }, 'Skip'),
        ),
      );
      void this.say(run, id, `[thinking] ${question}`, controls);
    });
  }

  private async talkToColleague(run: Run, i: number) {
    const c = run.scenario.colleagues[i];
    const who: ThingId = `person:${i}`;
    // In the first task, the colleague who runs the second one hints at it.
    const leadsNext = run.taskIndex === 0 && getScenario(run.scenario.id).taskB?.managerColleague === i;
    const lines = [...c.lines];
    if (c.openRole) lines.push(`${c.openRole}${leadsNext ? " You can pick that role when you come in from the plaza!" : ''}`);
    this.world.emote(who, 'happy');
    for (const line of lines) {
      if (this.run !== run) return;
      await this.say(run, who, line);
    }
  }

  private async examine(run: Run, key: string) {
    const item = run.scenario.examine[key];
    if (!item) return;
    this.world.act('player', 'look');
    for (const line of item.lines) {
      if (this.run !== run) return;
      await this.say(run, null, line);
    }
  }

  // ---- The task's steps, in the talk box with the manager ----

  /** Say the lines, the last with the controls shown in the box underneath. */
  private async speak(texts: string[], controls: HTMLElement | null) {
    const run = this.run;
    if (!run) return;
    for (let i = 0; i < texts.length; i++) {
      if (this.run !== run) return;
      await this.say(run, 'manager', texts[i], i === texts.length - 1 ? controls : null);
    }
  }

  private renderStep() {
    const run = this.run;
    if (!run) return;
    const s = run.scenario;
    this.refreshRoom();
    this.world.focus('manager');

    switch (run.step) {
      case 'write': {
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
          taskCard(run),
          findingsCard(run, false),
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
        void this.speak(reaction ? [reaction, s.writePrompt] : [s.writePrompt], controls);
        break;
      }
      case 'coach': {
        const c = run.coach!;
        const controls = h(
          'div',
          { class: 'block' },
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
        void this.speak(c.whatWorks ? [`[happy] ${c.whatWorks}`, `[idea] ${c.tip}`] : [`[idea] ${c.tip}`], controls);
        break;
      }
      case 'followup': {
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
        void this.speak([`[thinking] ${run.followupQuestion ?? ''}`], controls);
        break;
      }
      case 'feedback': {
        const fb = run.feedback!;
        const controls = h(
          'div',
          { class: 'block' },
          h('p', { class: 'label' }, 'Skills you used here'),
          h('div', { class: 'chips' }, fb.skills.map((sk) => skillChip(sk.skill, sk.weight === 2 ? 'main' : 'also'))),
          studyLine(run),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this.go('reflect') }, 'Continue')),
        );
        const reaction = this.takePending(run);
        const texts = [...(reaction ? [reaction] : []), `[proud] ${fb.npcReaction}`, ...(fb.acknowledgement ? [fb.acknowledgement] : [])];
        this.world.act('manager', 'nod');
        void this.speak(texts, controls).then(() => this.run === run && this.floatSkills(fb.skills));
        break;
      }
      case 'reflect': {
        const fb = run.feedback!;
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
        void this.speak([`[thinking] ${fb.reflectiveQuestion}`], controls);
        break;
      }
      case 'studies': {
        const reaction = this.takePending(run);
        const ta = h('textarea', { id: 'studies', rows: 3, maxlength: 400, placeholder: CONTENT.studies.placeholder, 'aria-labelledby': 'studies-l' }) as HTMLTextAreaElement;
        if (run.studyNote) ta.value = run.studyNote;
        const controls = h(
          'div',
          { class: 'block' },
          studyLine(run),
          h('label', { id: 'studies-l', class: 'label', for: 'studies' }, 'Your answer (optional, saved to your growth record)'),
          ta,
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => this.saveStudies(ta.value) }, 'Save and continue'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => this.saveStudies('') }, 'Skip'),
          ),
        );
        void this.speak(reaction ? [reaction, `[thinking] ${CONTENT.studies.question}`] : [`[thinking] ${CONTENT.studies.question}`], controls);
        break;
      }
      case 'rate': {
        const reaction = this.takePending(run);
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
        const controls = h(
          'div',
          { class: 'block' },
          h('p', { class: 'soft small' }, 'Just for you. This is how you felt, not how you did.'),
          scale('enjoyment', 'How much did you enjoy this?', '1 not much', '5 a lot'),
          scale('confidence', 'How confident did you feel?', '1 not very', '5 very'),
          more,
          hint,
          h('div', { class: 'actions' }, finish),
        );
        update();
        const line = 'Before you head out: how did that feel?';
        void this.speak(reaction ? [reaction, line] : [line], controls);
        break;
      }
      case 'resources': {
        const controls = h(
          'div',
          { class: 'block' },
          resourceList(s.resources, true),
          h('p', { class: 'label' }, 'For any humanities career'),
          resourceList(CONTENT.commonResources, false),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => this.endWork() }, 'Keep looking around'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => void this.exitToPlaza() }, 'Back to the plaza'),
          ),
        );
        const reaction = this.takePending(run);
        const resourcesLine = "If you want to know more about this kind of work, here's where I'd start. These links open in a new tab.";
        this.world.emote('manager', 'love');
        void this.speak(reaction ? [`[happy] ${reaction}`, resourcesLine] : [resourcesLine], controls);
        break;
      }
      default:
        break;
    }
  }

  /** The task is done: close the talk box and let the player wander. */
  private endWork() {
    const run = this.run;
    if (!run) return;
    run.step = 'done';
    this.inPanel = false;
    this.conversing = false;
    this.talk.hide();
    this.world.focus(null);
    this.world.setTalking(null);
    this.world.setFree(true);
    this.refreshRoom();
  }

  private go(step: Step) {
    if (!this.run) return;
    this.run.step = step;
    this.renderStep();
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
        c = await aiCoach(run.scenario.id, run.taskIndex, run.choiceId, run.written);
        if (this.run !== run) return;
      }
      // Only stop the student when the answer is clearly weak: the offline check says so, or the
      // AI does and the answer is very short. (The AI on its own is stricter than we want.)
      const offline = coachWriting(run.scenario, run.written);
      const words = run.written.split(/\s+/).filter(Boolean).length;
      const aiWeak = c?.status === 'could_strengthen' && words < 12;
      if (offline.status === 'could_strengthen' || aiWeak) c = c?.status === 'could_strengthen' ? c : offline;
      else c = { status: 'solid', tip: '' };
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
      const q = await aiFollowup(run.scenario.id, run.taskIndex, run.choiceId, run.written);
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

  /** "Thinking…" in the talk box while the AI replies, with the manager's head tilted. */
  private showThinking(run: Run, label: string) {
    this.world.emote('manager', 'thinking');
    this.announce(label);
    void this.say(run, 'manager', '…', h('p', { class: 'soft thinking', role: 'status' }, label, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'))));
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
      taskIndex: run.taskIndex,
      choiceId: run.choiceId,
      writtenResponse: run.written,
      isRevisit: run.isRevisit,
      twist: run.isRevisit ? run.scenario.twist : undefined,
      followupQuestion: run.followupQuestion,
      followupAnswer: run.followupAnswer,
      earlier: this.attempts.slice(-4).map((a) => {
        const sc = getTask(a.scenarioId, a.taskIndex ?? 0);
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
    this.go('studies');
  }

  private saveStudies(text: string) {
    if (!this.run) return;
    this.run.studyNote = text.trim() || undefined;
    this.run.pendingLine = this.run.studyNote ? this.run.scenario.reactions.studied : this.run.scenario.reactions.skippedStudies;
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
      taskIndex: run.taskIndex || undefined,
      startedAt: run.startedAt,
      choiceId: run.choiceId,
      writtenResponse: run.written,
      firstDraft: run.firstDraft !== undefined && run.firstDraft !== run.written ? run.firstDraft : undefined,
      revisions: run.revisions || undefined,
      reflectionNote: run.reflection,
      studyNote: run.studyNote,
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

/** How many of a building's roles the player has finished at least once. */
function rolesTried(attempts: Attempt[], id: ScenarioId): number {
  return new Set(attempts.filter((a) => a.scenarioId === id).map((a) => a.taskIndex ?? 0)).size;
}


/** The manager's avatar colour: the building's colour, or the colleague's when they run task B. */
function managerColor(run: { scenario: Scenario; taskIndex: TaskIndex }): string {
  const m = taskManagerIndex(run.scenario.id, run.taskIndex);
  return m === null ? NPC_COLOR[run.scenario.id] : personColor(run.scenario.id, m);
}

const STEPS: Step[] = ['brief', 'intro', 'choose', 'look', 'write', 'feedback', 'reflect', 'studies', 'rate', 'resources'];
/** Coaching is part of the writing step, so it shares its dot; done shares the last one. */
const stepIndex = (s: Step) => STEPS.indexOf(s === 'coach' || s === 'followup' ? 'write' : s === 'done' ? 'resources' : s);

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
      const s = getTask(a.scenarioId, a.taskIndex ?? 0);
      const opt = s.options.find((o) => o.id === a.choiceId);
      return h(
        'li',
        { class: 'attempt' },
        h(
          'div',
          { class: 'attempt-head' },
          h('span', { class: `bicon-wrap b-${a.scenarioId}` }, buildingIcon(a.scenarioId)),
          h('strong', null, s.building),
          h('span', { class: 'soft small' }, s.internRole),
          a.isRevisit ? h('span', { class: 'tag' }, 'Revisit') : null,
          h('time', { datetime: a.startedAt }, formatWhen(a.startedAt)),
        ),
        h('p', null, h('span', { class: 'k' }, 'You chose: '), opt?.text ?? ''),
        a.firstDraft ? h('blockquote', { class: 'sample draft' }, h('span', { class: 'k' }, 'First draft: '), `“${a.firstDraft}”`) : null,
        a.writtenResponse
          ? h('blockquote', { class: 'sample' }, h('span', { class: 'k' }, a.firstDraft ? 'After revising: ' : 'Your words: '), `“${a.writtenResponse}”`)
          : h('p', { class: 'soft' }, 'No written response this time.'),
        a.reflectionNote ? h('p', { class: 'note' }, h('span', { class: 'k' }, 'Your reflection: '), a.reflectionNote) : null,
        a.studyNote ? h('p', { class: 'note' }, h('span', { class: 'k' }, 'In your studies: '), a.studyNote) : null,
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
      section('rs-learn', 'Learn more about these roles', 'Links open in a new tab.', learnMore(r.attempts)),
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

/** Resources for each role tried, in plaza order. */
function learnMore(attempts: Attempt[]): HTMLElement {
  const tried = SCENARIO_IDS.flatMap((id) =>
    ([0, 1] as TaskIndex[]).filter((t) => attempts.some((a) => a.scenarioId === id && (a.taskIndex ?? 0) === t)).map((t) => ({ id, t })),
  );
  return h(
    'div',
    { class: 'learn' },
    tried.map(({ id, t }) => {
      const s = getTask(id, t);
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

// ---- Task reminder: what the student is working on, kept on screen while they write ----

function taskCard(run: { scenario: Scenario; choiceId?: ChoiceId; isRevisit: boolean }): HTMLElement {
  const s = run.scenario;
  const option = s.options.find((o) => o.id === run.choiceId);
  return h(
    'div',
    { class: 'task-card', role: 'note', 'aria-label': 'Your task' },
    h('p', { class: 'task-kicker' }, 'Your task'),
    h('p', null, s.brief),
    run.isRevisit ? h('p', null, h('span', { class: 'k' }, 'New this time: '), s.twist) : null,
    option ? h('p', null, h('span', { class: 'k' }, 'Your approach: '), option.text) : null,
  );
}

// ---- Coursework link and colleague colours --------------------------------------

/** Name-tag colours for each building's colleagues. */
const PERSON_COLORS: Record<ScenarioId, string[]> = {
  resort: ['#2F6F6A', '#C99A1E', '#6B4A8A'],
  policy: ['#3D7EA6', '#6E7D52', '#D06A50'],
  foundation: ['#2E6B5E', '#C77F6E', '#5B7DB1'],
  workforce: ['#B5694A', '#4A5560', '#8C3B4A'],
};
const personColor = (id: ScenarioId, i: number) => PERSON_COLORS[id][i % PERSON_COLORS[id].length];

/** "In your studies: …" for the student's chosen approach. */
function studyLine(run: { scenario: Scenario; choiceId?: ChoiceId }): HTMLElement | null {
  const option = run.scenario.options.find((o) => o.id === run.choiceId);
  if (!option?.studyLink) return null;
  return h('p', { class: 'study-link' }, h('span', { class: 'k' }, 'In your studies: '), option.studyLink);
}
