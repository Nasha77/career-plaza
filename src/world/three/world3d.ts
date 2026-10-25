import * as THREE from 'three';
import type { ScenarioId } from '../../types';
import { fade, reducedMotion, type World } from '../types';
import { buildAtmosphere, type Atmosphere } from './atmosphere';
import { buildInterior, type Interior } from './interiors';
import { Kit } from './kit';
import { LABEL_H, LABEL_W, buildPlaza, labelY, type BuildingHandle, type Plaza } from './plaza';

interface Tween {
  start: number;
  dur: number;
  step: (k: number) => void;
  done: () => void;
}

/** Light theme is a late-afternoon golden hour; dark theme is a moonlit night. */
const SKY = {
  light: {
    top: 0x5d9fd6, horizon: 0xf6dcb6, bottom: 0x9cc48a,
    hemiSky: 0xdfeaff, hemiGround: 0x8f9a66, hemi: 1.7,
    sun: 3.4, sunColor: 0xffd7a6, glow: 0xffcf8a, glowSize: 1, interior: 0xe4e0d4,
  },
  dark: {
    top: 0x060d1c, horizon: 0x1f3047, bottom: 0x2e4636,
    hemiSky: 0x8ea3cf, hemiGround: 0x2c3a33, hemi: 1.9,
    sun: 1.9, sunColor: 0xa9bcff, glow: 0xcfdcff, glowSize: 0.35, interior: 0x14211d,
  },
};
/** Low sun from the west-south-west, so shadows fall long across the plaza. */
const SUN_DIR = new THREE.Vector3(-0.72, 0.42, 0.55).normalize();

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp = THREE.MathUtils.clamp;
const DEG = Math.PI / 180;

export class World3D implements World {
  readonly mode = '3d' as const;
  onPick: ((id: ScenarioId) => void) | null = null;
  onHover: ((id: ScenarioId | null) => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.5, 500);
  private kit = new Kit();
  private plaza: Plaza;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fog: THREE.Fog;
  private atmosphere: Atmosphere;
  private lowPower: boolean;
  private intro = 0;
  private parallax = new THREE.Vector2();
  private parallaxTarget = new THREE.Vector2();
  private lastLift = 0;
  private interior: { kit: Kit; data: Interior; id: ScenarioId } | null = null;
  private lastBuilding: BuildingHandle | null = null;

  private state: 'plaza' | 'moving' | 'interior' = 'plaza';
  private visited = new Set<ScenarioId>();
  private pointerHover: ScenarioId | null = null;
  private uiHover: ScenarioId | null = null;
  private talking: 'guide' | 'npc' | null = null;
  private active = true;
  private raf = 0;
  private last = 0;
  private time = 0;
  private needsRender = true;
  private tweens: Tween[] = [];
  private dark = false;

  // Camera state
  private target = new THREE.Vector3(0, 1.5, 0);
  private orbitPhase = 0;
  private az = 0; // user nudge, radians
  private pol = 0;
  private zoom = 0;
  private interiorSway = 0;

  // Pointer state
  private pointers = new Map<number, { x: number; y: number }>();
  private dragFrom = { x: 0, y: 0, az: 0, pol: 0 };
  private moved = false;
  private pinch = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pickables: THREE.Object3D[] = [];

  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private veil: HTMLElement) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 1.5, powerPreference: 'high-performance' });
    if (!this.renderer.getContext()) throw new Error('No WebGL context');
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // One soft shadow map, rendered only when something changes (not every frame).
    this.lowPower = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    // Gradient sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
        glow: { value: new THREE.Color() },
        glowSize: { value: 1 },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 glow;
        uniform float glowSize; uniform vec3 sunDir; varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, bottom, min(1.0, -h * 4.0));
          float s = max(dot(d, sunDir), 0.0);
          // Wide warm haze, a tighter halo and the disc itself.
          c += glow * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6) * glowSize;
          c = mix(c, vec3(1.0, 0.98, 0.92), smoothstep(0.9993 - 0.0004 * glowSize, 0.9996, s));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), this.skyMat);
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8aa37a, 2);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(70);
    this.sun.castShadow = true;
    const shadow = this.sun.shadow;
    shadow.mapSize.setScalar(this.lowPower ? 1024 : 2048);
    shadow.camera.left = shadow.camera.bottom = -42;
    shadow.camera.right = shadow.camera.top = 42;
    shadow.camera.near = 10;
    shadow.camera.far = 160;
    shadow.bias = -0.0006;
    shadow.normalBias = 0.04;
    shadow.radius = 4;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.fog = new THREE.Fog(0xe6f0ea, 120, 320);
    this.scene.fog = this.fog;

    this.plaza = buildPlaza(this.kit);
    prepareForLighting(this.plaza.group);
    this.atmosphere = buildAtmosphere(this.kit, this.lowPower);
    this.plaza.group.add(this.atmosphere.group);
    this.scene.add(this.plaza.group);
    // Open with a slow sweep down onto the plaza.
    this.intro = reducedMotion() ? 0 : 1;
    this.plaza.buildings.forEach((b) => {
      b.hit.userData.buildingId = b.id;
      b.label.userData.buildingId = b.id;
      this.pickables.push(b.hit, b.label);
    });
    this.applyLit();

    // Theme
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => this.applyTheme(document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && mq.matches));
    onTheme();
    this.listen(mq, 'change', onTheme);
    const themeObserver = new MutationObserver(onTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.cleanup.push(() => themeObserver.disconnect());

    // Size
    const onResize = () => this.resize();
    this.listen(window, 'resize', onResize);
    this.listen(window, 'orientationchange', onResize);
    this.resize();

    // Input
    this.listen(canvas, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    this.listen(canvas, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    this.listen(canvas, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    this.listen(canvas, 'pointercancel', (e) => this.pointers.delete((e as PointerEvent).pointerId));
    this.listen(canvas, 'pointerleave', () => this.setPointerHover(null));
    this.listen(canvas, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });

    // Pause when the tab is hidden
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.stop();
      else if (this.active) this.start();
    });

    // Redraw text on signs once the web fonts are ready
    document.fonts?.ready.then(() => {
      this.kit.refreshCanvases();
      this.needsRender = true;
    });

    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
    this.start();
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn, opts);
    this.cleanup.push(() => t.removeEventListener(type, fn, opts));
  }

  // ---- Public API -----------------------------------------------------------

  setVisited(ids: ScenarioId[]): void {
    this.visited = new Set(ids);
    this.applyLit();
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  setHover(id: ScenarioId | null): void {
    this.uiHover = id;
    this.needsRender = true;
  }

  setTalking(who: 'guide' | 'npc' | null): void {
    this.talking = who;
    this.needsRender = true;
  }

  celebrate(id: ScenarioId): void {
    const b = this.plaza.buildings.get(id);
    if (b) b.pulse = 1;
    this.needsRender = true;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.needsRender = true;
      this.start();
    } else {
      this.stop();
    }
  }

  npcAnchor(): { x: number; y: number } | null {
    if (!this.interior) return null;
    const npc = this.interior.data.npc;
    const v = new THREE.Vector3(0, npc.topY + 0.4, 0);
    npc.group.localToWorld(v);
    v.project(this.camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { x: clamp(((v.x + 1) / 2) * w, 90, w - 90), y: clamp(((1 - v.y) / 2) * h, 110, h * 0.6) };
  }

  async enter(id: ScenarioId, midway?: () => void): Promise<void> {
    const b = this.plaza.buildings.get(id);
    if (!b || this.state !== 'plaza') {
      midway?.();
      return;
    }
    this.state = 'moving';
    this.lastBuilding = b;
    this.pointerHover = null;
    this.uiHover = null;
    const reduced = reducedMotion();

    if (!reduced) {
      const fromPos = this.camera.position.clone();
      const fromTarget = this.target.clone();
      const { pos, target } = this.doorShot(b);
      await this.tween(1050, (k) => {
        this.camera.position.lerpVectors(fromPos, pos, k);
        // Lift the path a little so the camera arcs over the plaza rather than through it.
        this.camera.position.y += Math.sin(k * Math.PI) * 2;
        this.target.lerpVectors(fromTarget, target, k);
        this.camera.lookAt(this.target);
      });
    }
    await fade(this.veil, true, reduced ? 160 : 260);

    // Swap to the interior diorama
    this.plaza.group.visible = false;
    this.sky.visible = false;
    this.scene.fog = null;
    this.scene.background = new THREE.Color(this.dark ? SKY.dark.interior : SKY.light.interior);
    const kit = new Kit();
    const data = buildInterior(kit, id, this.visited.has(id));
    prepareForLighting(data.group);
    this.scene.add(data.group);
    this.renderer.shadowMap.needsUpdate = true;
    this.interior = { kit, data, id };
    this.applyLights();
    this.state = 'interior';
    this.interiorSway = 0;
    this.applyViewOffset();
    this.placeCamera();
    midway?.();
    this.renderNow();
    await fade(this.veil, false, reduced ? 200 : 380);
  }

  async exit(midway?: () => void): Promise<void> {
    if (this.state !== 'interior') {
      midway?.();
      return;
    }
    this.state = 'moving';
    const reduced = reducedMotion();
    await fade(this.veil, true, reduced ? 160 : 240);

    if (this.interior) {
      this.scene.remove(this.interior.data.group);
      this.interior.kit.dispose();
      this.interior = null;
    }
    this.applyLights();
    this.plaza.group.visible = true;
    this.renderer.shadowMap.needsUpdate = true;
    this.sky.visible = true;
    this.scene.fog = this.fog;
    this.scene.background = null;
    this.applyViewOffset();

    const overview = this.overviewPose();
    const b = this.lastBuilding;
    if (!reduced && b) {
      const shot = this.doorShot(b);
      this.camera.position.copy(shot.pos);
      this.target.copy(shot.target);
      this.camera.lookAt(this.target);
    } else {
      this.camera.position.copy(overview.pos);
      this.target.copy(overview.target);
      this.camera.lookAt(this.target);
    }
    midway?.();
    this.renderNow();
    await fade(this.veil, false, reduced ? 200 : 320);

    if (!reduced && b) {
      const fromPos = this.camera.position.clone();
      const fromTarget = this.target.clone();
      await this.tween(1050, (k) => {
        this.camera.position.lerpVectors(fromPos, overview.pos, k);
        this.camera.position.y += Math.sin(k * Math.PI) * 2;
        this.target.lerpVectors(fromTarget, overview.target, k);
        this.camera.lookAt(this.target);
      });
    }
    this.state = 'plaza';
    this.needsRender = true;
  }

  dispose(): void {
    this.stop();
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.interior?.kit.dispose();
    this.interior = null;
    this.kit.dispose();
    this.skyMat.dispose();
    this.sky.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ---- Camera ---------------------------------------------------------------

  private overviewPose() {
    const aspect = this.camera.aspect;
    const tanH = Math.tan((this.camera.fov * DEG) / 2) * aspect;
    const intro = easeInOut(this.intro);
    const radius = (clamp(25 / tanH, 48, 92) + this.zoom) * (1 + intro * 0.55);
    const polar = (aspect < 1 ? 50 : 56) * DEG + this.pol - intro * 22 * DEG + this.parallax.y * 4 * DEG;
    const swing = reducedMotion() ? 0 : Math.sin(this.orbitPhase) * 15 * DEG;
    const azimuth = 45 * DEG + swing + this.az - intro * 70 * DEG + this.parallax.x * 6 * DEG;
    const target = new THREE.Vector3(0, 1.5, 0);
    const pos = new THREE.Vector3(
      Math.sin(polar) * Math.sin(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.cos(azimuth),
    )
      .multiplyScalar(radius)
      .add(target);
    return { pos, target };
  }

  private interiorPose() {
    const aspect = this.camera.aspect;
    const tanH = Math.tan((this.camera.fov * DEG) / 2) * aspect;
    const radius = clamp(9.2 / tanH, 18, 33);
    const target = this.interior?.data.target.clone() ?? new THREE.Vector3(0, 1.6, 0);
    const azimuth = 31 * DEG + (reducedMotion() ? 0 : Math.sin(this.interiorSway) * 3.5 * DEG);
    const polar = 63 * DEG;
    const pos = new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth))
      .multiplyScalar(radius)
      .add(target);
    return { pos, target };
  }

  private doorShot(b: BuildingHandle) {
    const target = b.door.clone().setY(2.4);
    const pos = b.door.clone().addScaledVector(b.toCenter, 8).setY(3.8);
    return { pos, target };
  }

  private placeCamera() {
    const pose = this.state === 'interior' ? this.interiorPose() : this.overviewPose();
    this.camera.position.copy(pose.pos);
    this.target.copy(pose.target);
    this.camera.lookAt(this.target);
  }

  /** Shifts the picture up so the dialogue card at the bottom doesn't cover the action. */
  private applyViewOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = w / h < 1;
    const share = this.state === 'interior' || this.interior ? (portrait ? 0.15 : 0.14) : portrait ? 0.14 : 0.08;
    this.camera.setViewOffset(w, h, 0, h * share, w, h);
    this.camera.updateProjectionMatrix();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Widen the view on tall phone screens so the whole plaza fits across.
    this.camera.fov = aspect < 1 ? THREE.MathUtils.lerp(46, 60, clamp((1 - aspect) / 0.55, 0, 1)) : 42;
    this.applyViewOffset();
    if (this.state !== 'moving') this.placeCamera();
    this.needsRender = true;
  }

  // ---- Theme and lit state ----------------------------------------------------

  private applyTheme(dark: boolean) {
    this.dark = dark;
    const p = dark ? SKY.dark : SKY.light;
    (this.skyMat.uniforms.top.value as THREE.Color).set(p.top);
    (this.skyMat.uniforms.horizon.value as THREE.Color).set(p.horizon);
    (this.skyMat.uniforms.bottom.value as THREE.Color).set(p.bottom);
    (this.skyMat.uniforms.glow.value as THREE.Color).set(p.glow);
    this.skyMat.uniforms.glowSize.value = p.glowSize;
    this.fog.color.set(p.horizon);
    this.atmosphere.theme(dark);
    this.renderer.shadowMap.needsUpdate = true;
    this.applyLights();
    if (this.interior) this.scene.background = new THREE.Color(p.interior);
    this.plaza.theme(dark);
    this.applyLit();
    this.needsRender = true;
  }

  /** Interiors are always lit like daytime rooms; the plaza follows the theme. */
  private applyLights() {
    const p = this.dark && !this.interior ? SKY.dark : SKY.light;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = this.interior ? 1.35 : p.hemi;
    this.sun.color.set(this.interior ? 0xfff0dc : p.sunColor);
    this.sun.intensity = this.interior ? 2.1 : p.sun;
    // Indoors the light comes from high on the camera side, so walls don't shade the floor.
    if (this.interior) this.sun.position.set(22, 34, 26);
    else this.sun.position.copy(SUN_DIR).multiplyScalar(70);
  }

  private applyLit() {
    this.plaza.buildings.forEach((b) => {
      b.lit = this.visited.has(b.id);
      b.windowMat.emissive.set(b.lit ? 0xffc65a : this.dark ? 0x2a3440 : 0x000000);
      b.windowMat.emissiveIntensity = b.lit ? (this.dark ? 1.3 : 0.7) : 1;
      b.windowMat.color.set(b.lit ? 0xffe6a8 : 0xcfe6ee);
      const dim = b.lit ? 1 : 0.8;
      b.bodyMats.forEach(({ m, base }) => m.color.copy(base).multiplyScalar(dim));
      b.sparkle.visible = b.lit;
    });
  }

  // ---- Input ------------------------------------------------------------------

  private interactive() {
    return this.state === 'plaza' && this.active && document.body.dataset.screen !== 'scenario';
  }

  private pick(x: number, y: number): ScenarioId | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    return (hit?.object.userData.buildingId as ScenarioId | undefined) ?? null;
  }

  private setPointerHover(id: ScenarioId | null) {
    if (id === this.pointerHover) return;
    this.pointerHover = id;
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.onHover?.(id);
    this.needsRender = true;
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.interactive()) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragFrom = { x: e.clientX, y: e.clientY, az: this.az, pol: this.pol };
      this.moved = false;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.moved = true;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.interactive()) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        this.setPointerHover(this.pick(e.clientX, e.clientY));
        this.parallaxTarget.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      }
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 1) {
      const dx = e.clientX - this.dragFrom.x;
      const dy = e.clientY - this.dragFrom.y;
      if (Math.hypot(dx, dy) > 8) this.moved = true;
      if (this.moved) {
        this.az = clamp(this.dragFrom.az - dx * 0.005, -0.6, 0.6);
        this.pol = clamp(this.dragFrom.pol - dy * 0.003, -0.22, 0.14);
        this.needsRender = true;
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoom = clamp(this.zoom - (d - this.pinch) * 0.08, -10, 16);
      this.pinch = d;
      this.needsRender = true;
    }
  }

  private onPointerUp(e: PointerEvent) {
    const had = this.pointers.delete(e.pointerId);
    if (!had || !this.interactive()) return;
    if (!this.moved && this.pointers.size === 0) {
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.onPick?.(id);
    }
  }

  private onWheel(e: WheelEvent) {
    if (!this.interactive()) return;
    e.preventDefault();
    this.zoom = clamp(this.zoom + e.deltaY * 0.02, -10, 16);
    this.needsRender = true;
  }

  // ---- Loop ---------------------------------------------------------------------

  private tween(dur: number, step: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), dur, step: (k) => step(easeInOut(k)), done: resolve });
      this.start();
    });
  }

  private start() {
    if (this.raf || !this.active || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private renderNow() {
    this.update(0);
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.active || document.hidden) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    for (const t of [...this.tweens]) {
      const k = Math.min(1, (now - t.start) / t.dur);
      t.step(k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(t), 1);
        t.done();
      }
    }

    const motion = !reducedMotion();
    const animating = motion || this.tweens.length > 0;
    if (animating || this.needsRender) {
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const motion = !reducedMotion();
    if (motion) this.time += dt;
    const t = this.time;

    if (this.state === 'plaza') {
      if (motion) this.orbitPhase += dt * ((Math.PI * 2) / 48);
      this.intro = motion ? Math.max(0, this.intro - dt / 3.6) : 0;
      if (motion) {
        this.parallax.x = THREE.MathUtils.damp(this.parallax.x, this.parallaxTarget.x, 3, dt);
        this.parallax.y = THREE.MathUtils.damp(this.parallax.y, this.parallaxTarget.y, 3, dt);
      }
      this.placeCamera();
    } else if (this.state === 'interior') {
      if (motion) this.interiorSway += dt * 0.35;
      this.placeCamera();
    }

    if (this.plaza.group.visible) {
      // Fountain ripples and jet
      this.plaza.rings.forEach((r, i) => {
        const ph = motion ? (t * 0.35 + i / 3) % 1 : i / 3;
        r.scale.setScalar(1 + ph * 1.55);
        (r.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - ph);
      });
      this.plaza.jet.scale.y = motion ? 1 + Math.sin(t * 3.2) * 0.14 : 1;
      this.plaza.water.uniforms.time.value = t;
      this.atmosphere.update(t, dt, motion);

      const hoverId = this.uiHover ?? this.pointerHover;
      this.plaza.buildings.forEach((b) => {
        const hovered = hoverId === b.id && this.state === 'plaza';
        b.liftTarget = hovered ? 0.5 : 0;
        b.lift = motion ? THREE.MathUtils.damp(b.lift, b.liftTarget, 10, dt) : b.liftTarget;
        if (Math.abs(b.lift - b.liftTarget) > 0.002) this.needsRender = true;
        b.group.position.y = b.lift;
        const ls = hovered ? 1.12 : 1;
        b.label.scale.set(LABEL_W * ls, LABEL_H * ls, 1);
        b.label.position.y = labelY(b.height) + b.lift;

        if (motion) b.animate?.(t);
        b.pulse = Math.max(0, b.pulse - dt * 0.5);
        const glow = b.lit ? 0.42 + (motion ? Math.sin(t * 2 + b.height) * 0.12 : 0) : 0;
        b.ringMat.color.set(b.lit ? 0xf2b634 : 0xffffff);
        b.ringMat.opacity = Math.min(0.95, glow + b.pulse * 0.5 + (hovered && !b.lit ? 0.35 : 0));
        b.ring.visible = b.ringMat.opacity > 0.01;
        b.ring.scale.setScalar(1 + b.pulse * 0.3);
        if (b.sparkle.visible) {
          b.sparkle.rotation.y = t * 1.6;
          b.sparkle.position.y = b.height + 0.9 + (motion ? Math.sin(t * 2.2) * 0.25 : 0);
          b.sparkle.scale.setScalar(1 + b.pulse * 1.2);
        }
      });
      this.plaza.guide.update(t, this.talking === 'guide', motion, this.camera);
      // Re-render shadows only while a building is rising or settling.
      let lift = 0;
      this.plaza.buildings.forEach((b) => (lift += b.lift));
      if (Math.abs(lift - this.lastLift) > 0.001) this.renderer.shadowMap.needsUpdate = true;
      this.lastLift = lift;
    }
    if (this.interior) this.interior.data.npc.update(t, this.talking === 'npc', motion, this.camera);
  }
}

/**
 * Lit meshes cast and receive the sun's shadow; flat decals and unlit text don't.
 * Canvas-drawn signs and charts skip tone mapping so their colours stay true.
 */
function prepareForLighting(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Sprite).isSprite) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const unlit = m.type === 'MeshBasicMaterial' || m.type === 'SpriteMaterial';
      if (unlit && (m as THREE.MeshBasicMaterial).map) m.toneMapped = false;
    }
    const lit = mats.some((m) => (m as THREE.Material).type === 'MeshLambertMaterial');
    const flat = mesh.geometry?.type === 'RingGeometry' || mesh.geometry?.type === 'CircleGeometry' || mesh.geometry?.type === 'PlaneGeometry';
    mesh.receiveShadow = lit;
    mesh.castShadow = lit && !flat && !mats.some((m) => m.transparent);
  });
}
