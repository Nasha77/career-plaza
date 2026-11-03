import type { ScenarioId, TaskIndex } from '../types';

/** Which task the room is set up for, and whether to show the "new this time" detail. */
export interface RoomSetup {
  task: TaskIndex;
  twist: boolean;
  /** Which Kenney character the player chose. */
  look: string;
  /** The building's reception lobby, where the player picks a role. */
  lobby?: boolean;
}

/** Something in a room you can walk up to: the manager, a colleague (by content index) or a spot. */
export type ThingId = 'manager' | `person:${number}` | `extra:${number}` | `spot:${string}`;
/** Who an emote or action is for: anything in the room, or the player. */
export type Who = ThingId | 'player';

export type Mood = 'happy' | 'excited' | 'surprised' | 'thinking' | 'worried' | 'proud' | 'love' | 'idea';
export type Marker = '!' | 'A' | 'B' | 'C';
export type BodyAction = 'look' | 'nod' | 'shake' | 'cheer' | 'pickup';

/**
 * The visual layer. The game logic only talks to this interface, so the 3D plaza
 * and the flat "Simple mode" plaza are interchangeable.
 */
export interface World {
  readonly mode: '3d' | 'simple';
  setVisited(ids: ScenarioId[]): void;
  setHover(id: ScenarioId | null): void;
  /** Move from the plaza into a building's interior, set up for one task. `midway` runs while the screen is veiled. */
  enter(id: ScenarioId, room: RoomSetup, midway?: () => void): Promise<void>;
  /** Go from one room to another in the same building (the lobby to an office), behind the veil. */
  changeRoom(id: ScenarioId, room: RoomSetup, midway?: () => void): Promise<void>;
  /** Move from an interior back out to the plaza. `midway` runs while the screen is veiled. */
  exit(midway?: () => void): Promise<void>;
  /** Who is speaking, for the talking bounce (the plaza guide, or someone in the room). */
  setTalking(who: 'guide' | Who | null): void;
  /** Screen position (CSS px) above the current speaker's head, if there is one. */
  npcAnchor(): { x: number; y: number } | null;
  /** Pause rendering while a full-screen page covers the scene. */
  setActive(active: boolean): void;
  celebrate(id: ScenarioId): void;
  dispose(): void;
  onPick: ((id: ScenarioId) => void) | null;
  onHover: ((id: ScenarioId | null) => void) | null;

  // ---- Inside a room ----
  /** Called after the player clicks something in the room and has walked over to it. */
  onThing: ((id: ThingId) => void) | null;
  /** Walk the player up to something and face it. Resolves on arrival (at once in Simple mode). */
  goTo(id: ThingId): Promise<void>;
  /** Let the player walk around, or hold still during a conversation. */
  setFree(free: boolean): void;
  /** Frame a conversation between the player and someone, or go back to following the player. */
  focus(id: ThingId | null): void;
  emote(who: Who, mood: Mood): void;
  act(who: Who, action: BodyAction): void;
  /** Lasting markers over things: the manager's "!" or the approach letters. Replaces the previous set. */
  mark(marks: Partial<Record<ThingId, Marker>>): void;
  /** Hover labels for the room's things, set by the game from the content. */
  setLabels(labels: Partial<Record<ThingId, string>>): void;
  /** The player's chosen character, so nobody else in the world shares it. */
  setPlayerLook(look: string): void;
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades the full-screen veil in or out. */
export function fade(el: HTMLElement, opaque: boolean, ms: number): Promise<void> {
  el.style.transitionDuration = `${ms}ms`;
  el.classList.toggle('on', opaque);
  return new Promise((r) => window.setTimeout(r, ms));
}
