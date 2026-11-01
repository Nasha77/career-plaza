import type { ScenarioId, TaskIndex } from '../types';

/** Which task the room is set up for, and whether to show the "new this time" detail. */
export interface RoomSetup {
  task: TaskIndex;
  twist: boolean;
}

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
  /** Move from an interior back out to the plaza. `midway` runs while the screen is veiled. */
  exit(midway?: () => void): Promise<void>;
  setTalking(who: 'guide' | 'npc' | null): void;
  /** Show the talking indicator on one of the room's colleagues (index into the building's colleagues). */
  setPersonTalking(index: number | null): void;
  /** Screen position (CSS px) above the current NPC's head, if there is one. */
  npcAnchor(): { x: number; y: number } | null;
  /** Pause rendering while a full-screen page covers the scene. */
  setActive(active: boolean): void;
  celebrate(id: ScenarioId): void;
  dispose(): void;
  onPick: ((id: ScenarioId) => void) | null;
  onHover: ((id: ScenarioId | null) => void) | null;
  /** Called when a colleague in the current room is clicked. */
  onPerson: ((index: number) => void) | null;
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades the full-screen veil in or out. */
export function fade(el: HTMLElement, opaque: boolean, ms: number): Promise<void> {
  el.style.transitionDuration = `${ms}ms`;
  el.classList.toggle('on', opaque);
  return new Promise((r) => window.setTimeout(r, ms));
}
