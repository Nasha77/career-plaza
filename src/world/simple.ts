import type { ScenarioId } from '../types';
import { fade, type World } from './types';

/** Flat 2D fallback: the plaza is the HTML building grid, so this only handles fades. */
export class SimpleWorld implements World {
  readonly mode = 'simple' as const;
  onPick: ((id: ScenarioId) => void) | null = null;
  onHover: ((id: ScenarioId | null) => void) | null = null;

  constructor(private veil: HTMLElement) {}

  setVisited(): void {}
  setHover(): void {}
  setTalking(): void {}
  setActive(): void {}
  celebrate(): void {}
  dispose(): void {}
  npcAnchor() {
    return null;
  }
  enter(_id: ScenarioId, midway?: () => void): Promise<void> {
    return this.swap(midway);
  }
  exit(midway?: () => void): Promise<void> {
    return this.swap(midway);
  }
  private async swap(midway?: () => void): Promise<void> {
    await fade(this.veil, true, 150);
    midway?.();
    await fade(this.veil, false, 200);
  }
}
