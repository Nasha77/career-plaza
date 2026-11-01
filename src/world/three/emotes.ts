import * as THREE from 'three';
import type { Mood } from '../types';

/**
 * Pop-up icons over people's heads, Animal Crossing style: a little white bubble with a
 * symbol that bounces in, holds, and fades. Also used for the bouncing "!" and approach markers.
 */

const GLYPH: Record<Mood | 'mark' | 'A' | 'B' | 'C', { text: string; color: string }> = {
  happy: { text: '♪', color: '#e0567a' },
  excited: { text: '!!', color: '#e3a21a' },
  surprised: { text: '!', color: '#d04a3a' },
  thinking: { text: '?', color: '#3d7ea6' },
  worried: { text: '💧', color: '#3d7ea6' },
  proud: { text: '★', color: '#e3a21a' },
  love: { text: '♥', color: '#e0567a' },
  idea: { text: '💡', color: '#e3a21a' },
  mark: { text: '!', color: '#ffffff' },
  A: { text: 'A', color: '#ffffff' },
  B: { text: 'B', color: '#ffffff' },
  C: { text: 'C', color: '#ffffff' },
};

const textures = new Map<string, THREE.CanvasTexture>();

function texture(kind: keyof typeof GLYPH): THREE.CanvasTexture {
  let t = textures.get(kind);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = GLYPH[kind];
  const solid = kind === 'mark' || kind.length === 1;
  // Bubble with a little tail
  ctx.fillStyle = solid ? '#e3a21a' : '#ffffff';
  ctx.strokeStyle = 'rgba(29,43,58,0.25)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(64, 56, 46, 0, Math.PI * 2);
  ctx.moveTo(52, 96);
  ctx.lineTo(64, 122);
  ctx.lineTo(76, 96);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = g.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${g.text.length > 1 && !/\p{Extended_Pictographic}/u.test(g.text) ? 52 : 64}px 'Bricolage Grotesque', 'Segoe UI Emoji', sans-serif`;
  ctx.fillText(g.text, 64, 60);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(kind, t);
  return t;
}

export class Emote {
  readonly sprite: THREE.Sprite;
  private age = 0;
  private life: number;

  constructor(kind: keyof typeof GLYPH, life = 1.8) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(kind), depthTest: false, transparent: true, toneMapped: false }));
    this.sprite.renderOrder = 10;
    this.sprite.center.set(0.5, 0);
    this.life = life;
    this.sprite.scale.setScalar(0.01);
  }

  /** Returns false once it has faded out (forever markers never do). */
  update(dt: number, motion: boolean, size = 1.1): boolean {
    this.age += dt;
    const pop = motion ? Math.min(1, this.age / 0.18) : 1;
    const overshoot = motion ? 1 + Math.sin(Math.min(1, this.age / 0.35) * Math.PI) * 0.18 : 1;
    const bob = motion && this.life === Infinity ? Math.sin(this.age * 4) * 0.12 : 0;
    this.sprite.scale.setScalar(size * pop * overshoot);
    this.sprite.position.y = bob;
    if (this.life === Infinity) return true;
    const fadeStart = this.life - 0.35;
    (this.sprite.material as THREE.SpriteMaterial).opacity = this.age > fadeStart ? Math.max(0, 1 - (this.age - fadeStart) / 0.35) : 1;
    return this.age < this.life;
  }

  dispose() {
    (this.sprite.material as THREE.SpriteMaterial).dispose();
  }
}

export type EmoteKind = keyof typeof GLYPH;
