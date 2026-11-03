import * as THREE from 'three';
import type { Mood } from '../types';
import { Emote, type EmoteKind } from './emotes';
import { WORLD, type Spawned } from './models';

export type Pose = 'idle' | 'sit';
export type Action = 'look' | 'nod' | 'shake' | 'cheer' | 'pickup';

const ACTION_CLIP: Record<Action, string> = {
  look: 'interact-right',
  nod: 'emote-yes',
  shake: 'emote-no',
  cheer: 'jump',
  pickup: 'pick-up',
};

/** How each mood shows on the body, on top of the icon. */
const MOOD_ACTION: Partial<Record<Mood, Action>> = {
  happy: 'nod',
  proud: 'nod',
  excited: 'cheer',
  love: 'nod',
  surprised: 'cheer',
};

const WALK_SPEED = 3.6; // units per second
const TMP = new THREE.Vector3();

/**
 * A Kenney Mini Character with its animations: idle, walk, sit and the short emotes.
 * It can walk a path, turn to face someone, glance at the player, and pop an emote icon.
 */
export class Actor {
  readonly group: THREE.Group;
  /** Height of the head top, for icons and the camera. */
  readonly topY = 0.84 * WORLD;
  talking = false;
  /** Where the head turns to look (for example, the player walking past). */
  lookAt: THREE.Vector3 | null = null;

  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private base: Pose = 'idle';
  private head: THREE.Object3D | null = null;
  private headRest: THREE.Euler | null = null;
  private headYaw = 0;
  private headTilt = 0;
  private tiltUntil = 0;
  private yaw = 0;
  private targetYaw = 0;
  private path: [number, number][] = [];
  private arrive: (() => void) | null = null;
  private once: { until: number } | null = null;
  private age = Math.random() * 10;
  private emotes: Emote[] = [];
  private marker: Emote | null = null;
  private markerKind: EmoteKind | null = null;
  private iconAnchor = new THREE.Group();

  constructor(sp: Spawned, pose: Pose = 'idle') {
    this.group = sp.object;
    this.mixer = new THREE.AnimationMixer(this.group);
    for (const clip of sp.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.group.traverse((o) => {
      if (o.name === 'head') this.head = o;
    });
    this.headRest = this.head?.rotation.clone() ?? null;
    this.iconAnchor.position.y = this.topY + 0.25;
    this.group.add(this.iconAnchor);
    this.setPose(pose);
    // Start each idle at a different point so a room doesn't breathe in unison.
    this.mixer.update(Math.random() * 1.3);
  }

  private steering = false;

  get walking() {
    return this.path.length > 0 || this.steering;
  }

  setPose(p: Pose) {
    this.base = p;
    if (!this.walking && !this.once) this.fadeTo(p);
  }

  private fadeTo(name: string, loop = true) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.play();
    if (this.current) this.current.crossFadeTo(next, 0.18, false);
    this.current = next;
  }

  place(x: number, z: number, yaw: number) {
    this.group.position.set(x, 0, z);
    this.yaw = this.targetYaw = yaw;
    this.group.rotation.y = yaw;
  }

  /** Turn toward a point; `towardYaw` and `share` angle them partly toward the camera, as in a conversation. */
  face(x: number, z: number, towardYaw?: number, share = 0) {
    const p = this.group.position;
    if (Math.hypot(x - p.x, z - p.z) < 0.01) return;
    let yaw = Math.atan2(x - p.x, z - p.z);
    if (towardYaw !== undefined && share) {
      const d = Math.atan2(Math.sin(towardYaw - yaw), Math.cos(towardYaw - yaw));
      yaw += d * share;
    }
    this.targetYaw = yaw;
  }

  /** Walk a path of floor points. Resolves on arrival (or when interrupted by a new walk). */
  walk(points: [number, number][]): Promise<void> {
    this.arrive?.();
    this.path = points.slice();
    if (!this.path.length) return Promise.resolve();
    this.once = null;
    this.fadeTo('walk');
    return new Promise((r) => (this.arrive = r));
  }

  stop() {
    this.path = [];
    this.arrive?.();
    this.arrive = null;
    this.fadeTo(this.base);
  }

  /** Jump to the end of the walk (reduced motion). */
  finishWalk() {
    const last = this.path[this.path.length - 1];
    if (last) {
      const prev = this.path.length > 1 ? this.path[this.path.length - 2] : [this.group.position.x, this.group.position.z];
      this.group.position.set(last[0], 0, last[1]);
      this.targetYaw = Math.atan2(last[0] - prev[0], last[1] - prev[1]);
    }
    this.stop();
  }

  /** Keyboard walking: move by (dx, dz) per second if the floor allows, sliding along walls. */
  steer(dx: number, dz: number, dt: number, canGo: (x: number, z: number) => boolean) {
    const len = Math.hypot(dx, dz);
    if (len < 0.01) {
      if (this.steering) {
        this.steering = false;
        this.fadeTo(this.base);
      }
      return;
    }
    if (this.path.length) this.stop();
    if (!this.steering) {
      this.steering = true;
      this.once = null;
      this.fadeTo('walk');
    }
    const p = this.group.position;
    const sx = (dx / len) * WALK_SPEED * dt;
    const sz = (dz / len) * WALK_SPEED * dt;
    if (canGo(p.x + sx, p.z + sz)) p.set(p.x + sx, 0, p.z + sz);
    else if (canGo(p.x + sx, p.z)) p.x += sx;
    else if (canGo(p.x, p.z + sz)) p.z += sz;
    this.targetYaw = Math.atan2(dx, dz);
  }

  /** A short one-off movement, then back to idle or sitting. */
  act(a: Action) {
    if (this.walking) return;
    const name = ACTION_CLIP[a];
    const action = this.actions.get(name);
    if (!action) return;
    this.fadeTo(name, false);
    this.once = { until: this.age + action.getClip().duration + 0.25 };
  }

  emote(mood: Mood | EmoteKind, motion = true) {
    // One icon at a time over a head, as in Animal Crossing: a new emote replaces the last.
    for (const old of this.emotes) {
      this.iconAnchor.remove(old.sprite);
      old.dispose();
    }
    this.emotes.length = 0;
    const e = new Emote(mood as EmoteKind);
    this.iconAnchor.add(e.sprite);
    this.emotes.push(e);
    const a = MOOD_ACTION[mood as Mood];
    if (a && motion && this.base !== 'sit') this.act(a);
    if (mood === 'thinking' || mood === 'worried') this.tiltUntil = this.age + 1.6;
  }

  /** A lasting bouncing marker over the head ("!" or an approach letter), or none. */
  setMarker(kind: EmoteKind | null) {
    if (kind === this.markerKind) return;
    if (this.marker) {
      this.iconAnchor.remove(this.marker.sprite);
      this.marker.dispose();
      this.marker = null;
    }
    this.markerKind = kind;
    if (!kind) return;
    this.marker = new Emote(kind, Infinity);
    this.iconAnchor.add(this.marker.sprite);
  }

  /** Returns true while something is still moving (so the caller keeps rendering). */
  update(dt: number, motion: boolean): boolean {
    this.age += dt;
    let busy = false;

    if (this.path.length) {
      busy = true;
      const [tx, tz] = this.path[0];
      const p = this.group.position;
      const dx = tx - p.x;
      const dz = tz - p.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = WALK_SPEED * dt;
      this.targetYaw = Math.atan2(dx, dz);
      if (dist <= stepLen) {
        p.set(tx, 0, tz);
        this.path.shift();
        if (!this.path.length) {
          this.fadeTo(this.base);
          const done = this.arrive;
          this.arrive = null;
          done?.();
        }
      } else {
        p.x += (dx / dist) * stepLen;
        p.z += (dz / dist) * stepLen;
      }
    }

    if (this.once && this.age > this.once.until) {
      this.once = null;
      this.fadeTo(this.walking ? 'walk' : this.base);
    }

    // Turn smoothly toward where we're going or who we're facing
    let diff = this.targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > 0.001) {
      this.yaw += motion ? diff * Math.min(1, dt * 10) : diff;
      busy = true;
    }
    this.group.rotation.y = this.yaw;

    // Reset the head first: clips that don't move it would otherwise keep last frame's turn.
    if (this.head && this.headRest) this.head.rotation.copy(this.headRest);
    this.mixer.update(motion ? dt : 0);

    // Glance at whoever is nearby, and tilt the head when unsure
    if (this.head) {
      let want = 0;
      if (this.lookAt && !this.walking) {
        this.group.getWorldPosition(TMP);
        const ang = Math.atan2(this.lookAt.x - TMP.x, this.lookAt.z - TMP.z) - this.yaw;
        want = THREE.MathUtils.clamp(Math.atan2(Math.sin(ang), Math.cos(ang)), -0.8, 0.8);
      }
      this.headYaw = motion ? THREE.MathUtils.damp(this.headYaw, want, 6, dt) : want;
      const tilt = this.age < this.tiltUntil ? 0.28 : 0;
      this.headTilt = motion ? THREE.MathUtils.damp(this.headTilt, tilt, 6, dt) : tilt;
      this.head.rotation.y += this.headYaw;
      this.head.rotation.z += this.headTilt;
    }

    // A little bounce in time with speech, like Animal Crossing
    const bounce = this.talking && motion ? Math.abs(Math.sin(this.age * 11)) * 0.035 : 0;
    this.group.scale.set(1 - bounce * 0.5, 1 + bounce, 1 - bounce * 0.5);

    for (const e of [...this.emotes]) {
      if (!e.update(dt, motion)) {
        this.iconAnchor.remove(e.sprite);
        e.dispose();
        this.emotes.splice(this.emotes.indexOf(e), 1);
      }
    }
    if (this.marker) {
      // The lasting marker steps aside while an emote is showing, so the two never overlap.
      this.marker.sprite.visible = this.emotes.length === 0;
      this.marker.update(dt, motion, 0.9);
    }
    // Raise the icons a little when sitting
    this.iconAnchor.position.y = this.topY + (this.base === 'sit' ? -0.3 : 0.25);
    return busy || this.emotes.length > 0;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.setMarker(null);
    this.emotes.forEach((e) => e.dispose());
  }
}
