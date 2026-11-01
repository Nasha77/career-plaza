import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

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

/** All 12 Mini Characters, used for the player and everyone in the rooms. */
export const LOOKS = [
  'character-female-a',
  'character-female-b',
  'character-female-c',
  'character-female-d',
  'character-female-e',
  'character-female-f',
  'character-male-a',
  'character-male-b',
  'character-male-c',
  'character-male-d',
  'character-male-e',
  'character-male-f',
] as const;
export type Look = (typeof LOOKS)[number];
