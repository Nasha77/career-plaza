import * as THREE from 'three';
import { getTask, taskManagerIndex } from '../../content';
import type { ScenarioId } from '../../types';
import type { RoomSetup, ThingId } from '../types';
import { Actor } from './actor';
import { BACK_Z, LEFT_X, boardsFor, buildShape, frame, lobbyBoards, wallShelf } from './boards';
import { Kit } from './kit';
import { castFor, extraLook } from '../cast';
import { LOBBY, ROOM_SCALE, layoutFor, onFloor } from './layouts';
import { spawn, spawnCharacter } from './models';
import { WalkGrid } from './walkgrid';

/** A built room: furniture, people, the player, the walk grid and the click targets. */
/** How tall standing furniture is, compared with the furniture kit's own proportions. */
const FURNITURE_HEIGHT = 0.75;

export interface Room {
  id: ScenarioId;
  kit: Kit;
  group: THREE.Group;
  floor: THREE.Object3D;
  grid: WalkGrid;
  player: Actor;
  /** Everyone you can talk to, by thing id. */
  actors: Map<ThingId, Actor>;
  /** Floor position (and height) of every thing, for walking up to it and placing markers. */
  things: Map<ThingId, THREE.Vector3>;
  /** Invisible click targets; userData.thing holds the id. */
  hits: THREE.Mesh[];
  /** Markers for spots hang from these anchors. */
  spotAnchors: Map<ThingId, THREE.Group>;
  /** The floor's outer edges [x0, z0, x1, z1], for framing the camera. */
  bounds: [number, number, number, number];
  /** The reception lobby (where the player talks to the receptionist across the desk). */
  lobby: boolean;
}


export async function buildRoom(id: ScenarioId, setup: RoomSetup): Promise<Room> {
  const kit = new Kit();
  const group = new THREE.Group();
  const layout = setup.lobby ? LOBBY : layoutFor(id, setup.task);
  const floor = buildShape(kit, group, id, layout.floor, layout.partitions ?? []);
  // The boards, shelves and frames are drawn for the room's original size; spread them out to
  // the room's walls (their sizes stay the same).
  const wallThings = new THREE.Group();
  if (setup.lobby) lobbyBoards(kit, wallThings, id);
  else boardsFor(id, setup.task)(kit, wallThings, setup.twist);
  for (const [x, y, w] of layout.shelves ?? []) wallShelf(kit, wallThings, x / ROOM_SCALE, y, w);
  (layout.frames ?? []).forEach(([x, y, w, h, seed, wall]) => frame(kit, wallThings, x / ROOM_SCALE, y, w, h, seed, wall));
  wallThings.children.forEach((c) => {
    c.position.x *= ROOM_SCALE;
    c.position.z *= ROOM_SCALE;
  });
  group.add(wallThings);
  const cast = castFor(setup.look).rooms[id];
  const managerIndex = setup.lobby ? null : taskManagerIndex(id, setup.task);
  // The walkable floor: inside the room's shape, a little way off the walls.
  const grid = new WalkGrid(16 * ROOM_SCALE, 12 * ROOM_SCALE, 0.5);
  grid.blockWhere((x, z) => !(onFloor(layout, x, z) && onFloor(layout, x - 0.7, z) && onFloor(layout, x + 0.7, z) && onFloor(layout, x, z - 0.7) && onFloor(layout, x, z + 0.3)));
  for (const [x0, z0, x1, z1] of layout.partitions ?? []) {
    grid.blockRect((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) + 0.3, Math.abs(z1 - z0) + 0.3, 0, 0.2);
  }

  // Furniture: load everything at once, then place in order so things can stack.
  const spawned = await Promise.all(layout.props.map((p) => spawn(p.m, p.s ?? 1)));
  const tops: number[] = [];
  layout.props.forEach((p, i) => {
    const sp = spawned[i];
    const y = p.y ?? (p.on !== undefined ? tops[p.on] : 0);
    // The Mini Characters are chunky and short-legged, so standing furniture is lowered to their
    // scale: a desk comes up to their middle, not their shoulders. Small things keep their shape.
    const squash = p.on === undefined && p.y === undefined && p.m.startsWith('furniture/') && !/plant|lamp|rug|coatRack/i.test(p.m) ? FURNITURE_HEIGHT : 1;
    sp.object.scale.y = squash;
    sp.object.position.set(p.x, y, p.z);
    sp.object.rotation.y = p.r ?? 0;
    group.add(sp.object);
    tops[i] = y + sp.size.y * squash;
    if (!p.walk && p.on === undefined && p.y === undefined) grid.blockRect(p.x, p.z, sp.size.x, sp.size.z, p.r ?? 0);
    if (p.walk) sp.object.traverse((o) => ((o as THREE.Mesh).castShadow = false));
  });

  const actors = new Map<ThingId, Actor>();
  const things = new Map<ThingId, THREE.Vector3>();
  const hits: THREE.Mesh[] = [];
  const hitMat = kit.basic(0xffffff);
  hitMat.visible = false;
  const addHit = (thing: ThingId, x: number, y: number, z: number, w: number, h: number) => {
    const hit = kit.box(w, h, w, hitMat, x, y, z);
    hit.userData.thing = thing;
    group.add(hit);
    hits.push(hit);
  };

  // The way out is where the player came in: a green mat with an arrow at the front edge, like the
  // way-out mats in Pokemon interiors. The front is open to the camera, so nothing tall stands there.
  const [dx, dz] = layout.door;
  const matTex = kit.canvasTexture(256, 160, (ctx, w, h) => {
    ctx.fillStyle = '#4f9a62';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 18);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = "900 46px 'Nunito', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', w / 2, 70);
    // An arrow pointing out of the room, toward the camera
    ctx.beginPath();
    ctx.moveTo(w / 2 - 34, 96);
    ctx.lineTo(w / 2 + 34, 96);
    ctx.lineTo(w / 2, 136);
    ctx.closePath();
    ctx.fill();
  });
  const plane = kit.geo('plane', () => new THREE.PlaneGeometry(1, 1));
  const mat = new THREE.Mesh(plane, kit.track(new THREE.MeshLambertMaterial({ map: matTex })));
  mat.rotation.x = -Math.PI / 2;
  mat.scale.set(2.6, 1.6, 1);
  mat.position.set(dx, 0.16, dz + 0.1);
  mat.receiveShadow = true;
  group.add(mat);
  things.set('spot:exit', new THREE.Vector3(dx, 1.2, dz + 0.1));
  // A low, flat target over the mat, so clicking the floor elsewhere still just walks.
  addHit('spot:exit', dx, 0.3, dz + 0.1, 1.8, 0.6);

  // People
  // In the lobby, the 'manager' spot is the receptionist.
  const managerLook = setup.lobby ? cast.reception : managerIndex === null ? cast.manager : cast.colleagues[managerIndex];
  const people: [ThingId, string, { x: number; z: number; r: number; pose?: 'idle' | 'sit' }][] = [['manager', managerLook, layout.manager]];
  cast.colleagues.forEach((look, i) => {
    const at = layout.people[i];
    if (at && i !== managerIndex) people.push([`person:${i}`, look, at]);
  });
  // Background extras: repeated models in new skin tones and outfits, never the player's model.
  const roomSeed = ['resort', 'policy', 'foundation', 'workforce'].indexOf(id) * 10 + setup.task * 5;
  const extraInfo = setup.lobby ? [] : getTask(id, setup.task).extras;
  (layout.extras ?? []).forEach((at, i) => people.push([`extra:${i}`, extraLook(roomSeed + i + 1, setup.look, extraInfo[i]?.gender), at]));
  const actorModels = await Promise.all([...people.map(([, look]) => spawnCharacter(look)), spawnCharacter(setup.look)]);
  // Nobody stands inside furniture: anyone overlapping something moves to the nearest clear spot.
  const fits = (x: number, z: number) =>
    grid.free(x, z) && [0, 1, 2, 3, 4, 5, 6, 7].every((k) => grid.free(x + Math.cos((k * Math.PI) / 4) * 0.5, z + Math.sin((k * Math.PI) / 4) * 0.5));
  const clearSpot = (x: number, z: number): [number, number] => {
    if (fits(x, z)) return [x, z];
    for (let r = 0.25; r <= 3; r += 0.25)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const nx = x + Math.cos(a) * r;
        const nz = z + Math.sin(a) * r;
        if (fits(nx, nz)) return [nx, nz];
      }
    return [x, z];
  };
  people.forEach(([thing, , spot], i) => {
    const [cx, cz] = clearSpot(spot.x, spot.z);
    const at = { ...spot, x: cx, z: cz };
    const a = new Actor(actorModels[i], at.pose ?? 'idle');
    a.place(at.x, at.z, at.r);
    group.add(a.group);
    actors.set(thing, a);
    things.set(thing, new THREE.Vector3(at.x, a.topY, at.z));
    // The Mini Characters are chunky, so give everyone a little personal space.
    grid.blockCircle(at.x, at.z, 1.1);
    addHit(thing, at.x, 1.3, at.z, 1.5, 2.8);
  });

  const spotAnchors = new Map<ThingId, THREE.Group>();
  for (const [key, s] of Object.entries(layout.spots)) {
    const thing: ThingId = `spot:${key}`;
    const y = s.y ?? 1.6;
    things.set(thing, new THREE.Vector3(s.x, y, s.z));
    // Wall spots get a flat target on the wall; floor spots a box around the object.
    const onBack = s.z <= BACK_Z + 0.3;
    const onLeft = s.x <= LEFT_X + 0.3;
    if (onBack) addHit(thing, s.x, y, s.z + 0.3, 2.6, 2.4);
    else if (onLeft) addHit(thing, s.x + 0.3, y, s.z, 1.8, 2.0);
    else addHit(thing, s.x, 1.0, s.z, 1.9, 2.2);
    const anchor = new THREE.Group();
    anchor.position.set(onLeft ? s.x + 0.6 : s.x, Math.max(y, 1.4) + 1.3, onBack ? s.z + 0.6 : s.z);
    group.add(anchor);
    spotAnchors.set(thing, anchor);
  }

  const player = new Actor(actorModels[actorModels.length - 1]);
  // One step in from the exit mat, so the way out stays in view.
  const [sx, sz] = grid.free(layout.door[0], layout.door[1] - 1.4) ? [layout.door[0], layout.door[1] - 1.4] : layout.door;
  player.place(sx, sz, Math.PI);
  group.add(player.group);

  const bounds = layout.floor.reduce(
    (b, [x0, z0, x1, z1]) => [Math.min(b[0], x0), Math.min(b[1], z0), Math.max(b[2], x1), Math.max(b[3], z1)] as [number, number, number, number],
    [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number],
  );
  return { id, kit, group, floor, grid, player, actors, things, hits, spotAnchors, bounds, lobby: !!setup.lobby };
}

export function disposeRoom(room: Room) {
  room.actors.forEach((a) => a.dispose());
  room.player.dispose();
  room.kit.dispose();
}
