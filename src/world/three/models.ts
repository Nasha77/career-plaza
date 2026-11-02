import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { modelOf, recolourMap, variantOf } from '../cast';

/**
 * Kenney models (CC0, kenney.nl) loaded from public/models. Each file loads once and is
 * cloned for every copy, so the geometry and materials are shared and never disposed.
 */

/** Kenney's Mini Characters are about 0.8 tall; this brings everything up to the room's scale. */
export const WORLD = 3.2;

/** Each pack was made at its own scale; these bring them in line with the characters. */
const PACK_SCALE: Record<string, number> = {
  characters: 1,
  furniture: 1.2,
  market: 0.8,
  holiday: 0.5,
  food: 0.6,
  nature: 1,
  building: 0.5,
};

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

const url = (path: string) => `${import.meta.env.BASE_URL}models/${path}.glb`;

export function loadModel(path: string): Promise<GLTF> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(url(path));
    cache.set(path, p);
  }
  return p;
}

/** Start loading models early, for example while the camera flies to a door. */
export function preload(paths: string[]) {
  paths.forEach((p) => void loadModel(p).catch(() => cache.delete(p)));
}

export interface Spawned {
  /** Positioned at the origin, standing on y = 0, footprint centred (except characters). */
  object: THREE.Group;
  animations: THREE.AnimationClip[];
  /** Footprint size on the floor, before any rotation. */
  size: THREE.Vector3;
}

const BOX = new THREE.Box3();

/** A fresh copy of a model, scaled to the room. */
export async function spawn(path: string, scale = 1): Promise<Spawned> {
  const gltf = await loadModel(path);
  const animated = gltf.animations.length > 0;
  const inner = (animated ? cloneSkinned(gltf.scene) : gltf.scene.clone(true)) as THREE.Object3D;
  const pack = path.split('/')[0];
  inner.scale.setScalar(WORLD * (PACK_SCALE[pack] ?? 1) * scale);
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  inner.updateMatrixWorld(true);
  BOX.setFromObject(inner);
  const size = BOX.getSize(new THREE.Vector3());
  // Furniture origins sit at a corner; centre the footprint so placement and blocking are simple.
  if (!animated) {
    const c = BOX.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -BOX.min.y, -c.z);
  }
  const object = new THREE.Group();
  object.add(inner);
  return { object, animations: gltf.animations, size };
}

const variantTextures = new Map<number, THREE.Texture>();
const variantMaterials = new Map<string, THREE.Material>();

/**
 * A character by look ("character-male-a" or "character-male-a#2"). Recoloured looks get their
 * own copy of the colour swatch texture, so hair and clothes change while skin stays the same.
 */
export async function spawnCharacter(look: string, scale = 1): Promise<Spawned> {
  const model = modelOf(look);
  const variant = variantOf(look);
  const sp = await spawn(`characters/${model}`, scale);
  if (!variant) return sp;
  sp.object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m) => {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.map?.image) return m;
      const done = variantMaterials.get(`${std.uuid}:${variant}`);
      if (done) return done;
      let tex = variantTextures.get(variant);
      if (!tex) {
        const img = std.map.image as CanvasImageSource & { width: number; height: number };
        tex = new THREE.CanvasTexture(recolourMap(img, variant));
        tex.colorSpace = std.map.colorSpace;
        tex.flipY = std.map.flipY;
        tex.magFilter = std.map.magFilter;
        tex.minFilter = std.map.minFilter;
        tex.wrapS = std.map.wrapS;
        tex.wrapT = std.map.wrapT;
        variantTextures.set(variant, tex);
      }
      // Shared like the originals: one recoloured material per look, kept for the whole visit.
      const c = std.clone();
      c.map = tex;
      variantMaterials.set(`${std.uuid}:${variant}`, c);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
  return sp;
}
