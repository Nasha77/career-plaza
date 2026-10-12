import * as THREE from 'three';

type MatOpts = {
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  /** Give this mesh its own material so it can change colour independently. */
  unique?: boolean;
  side?: THREE.Side;
};

/**
 * Builds low-poly objects from shared primitives and tracks every GPU resource it
 * creates, so a whole scene (e.g. one interior) can be disposed in one call.
 */
export class Kit {
  private geos = new Map<string, THREE.BufferGeometry>();
  private mats = new Map<string, THREE.Material>();
  private owned: { dispose(): void }[] = [];
  private canvases: { c: HTMLCanvasElement; tex: THREE.CanvasTexture; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }[] = [];

  geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geos.get(key) as T | undefined;
    if (!g) {
      g = make();
      this.geos.set(key, g);
    }
    return g;
  }

  track<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  lambert(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.MeshLambertMaterial {
    const key = `l:${new THREE.Color(color).getHexString()}:${o.emissive ?? ''}:${o.emissiveIntensity ?? ''}:${o.opacity ?? ''}:${o.side ?? ''}`;
    if (!o.unique && this.mats.has(key)) return this.mats.get(key) as THREE.MeshLambertMaterial;
    const m = new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
    });
    if (o.unique) this.track(m);
    else this.mats.set(key, m);
    return m;
  }

  basic(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.MeshBasicMaterial {
    const key = `b:${new THREE.Color(color).getHexString()}:${o.opacity ?? ''}:${o.side ?? ''}`;
    if (!o.unique && this.mats.has(key)) return this.mats.get(key) as THREE.MeshBasicMaterial;
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: o.transparent ?? (o.opacity !== undefined && o.opacity < 1),
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      depthWrite: !(o.opacity !== undefined && o.opacity < 1),
    });
    if (o.unique) this.track(m);
    else this.mats.set(key, m);
    return m;
  }

  /** A unit box scaled to size. Avoid parenting other objects to it (the scale would carry over). */
  box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    return m;
  }

  cyl(rTop: number, rBot: number, h: number, seg: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(
      this.geo(`cyl:${rTop}:${rBot}:${h}:${seg}`, () => new THREE.CylinderGeometry(rTop, rBot, h, seg)),
      mat,
    );
    m.position.set(x, y, z);
    return m;
  }

  sphere(r: number, detail: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(`ico:${r}:${detail}`, () => new THREE.IcosahedronGeometry(r, detail)), mat);
    m.position.set(x, y, z);
    return m;
  }

  /** Triangular prism (gable roof / pediment): width along x, height up, depth along z. */
  prism(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
    const g = this.geo(`prism:${w}:${h}:${d}`, () => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0);
      s.lineTo(w / 2, 0);
      s.lineTo(0, h);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
      geo.translate(0, 0, -d / 2);
      return geo;
    });
    return new THREE.Mesh(g, mat);
  }

  /** Flat disc/ring lying on the ground. */
  ring(inner: number, outer: number, seg: number, mat: THREE.Material): THREE.Mesh {
    const g = this.geo(`ring:${inner}:${outer}:${seg}`, () => {
      const r = new THREE.RingGeometry(inner, outer, seg);
      r.rotateX(-Math.PI / 2);
      return r;
    });
    return new THREE.Mesh(g, mat);
  }

  /** A texture drawn with the 2D canvas API (no image files). */
  canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.canvases.push({ c, tex: t, draw });
    return this.track(t);
  }

  /** Redraw canvas textures, e.g. once web fonts have finished loading. */
  refreshCanvases() {
    for (const { c, tex, draw } of this.canvases) {
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, c.width, c.height);
      draw(ctx, c.width, c.height);
      tex.needsUpdate = true;
    }
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.owned.forEach((o) => o.dispose());
    this.geos.clear();
    this.mats.clear();
    this.owned = [];
    this.canvases = [];
  }
}

export const FONT = "'Atkinson Hyperlegible', 'Segoe UI', system-ui, sans-serif";
export const DISPLAY_FONT = "'Bricolage Grotesque', 'Atkinson Hyperlegible', 'Segoe UI', sans-serif";

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
