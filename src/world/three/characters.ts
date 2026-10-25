import * as THREE from 'three';
import type { Kit } from './kit';

const TMP_Q = new THREE.Quaternion();

export type Accessory = 'cap' | 'tie' | 'backpack' | 'headphones' | 'glasses' | 'lanyard';

export interface CharacterSpec {
  body: number;
  legs: number;
  skin: number;
  hair: number;
  accessory: Accessory;
  accent: number;
  hairStyle?: 'short' | 'bun' | 'long';
  seated?: boolean;
}

export interface Character {
  group: THREE.Group;
  /** Height of the speech bubble, in local units. */
  topY: number;
  update(t: number, talking: boolean, motion: boolean, camera: THREE.Camera): void;
}

/** Simple low-poly figure: capsule body, sphere head, one accessory, a blob shadow. */
export function makeCharacter(kit: Kit, spec: CharacterSpec): Character {
  const group = new THREE.Group();
  const rig = new THREE.Group(); // bobs and sways
  group.add(rig);

  const seatDrop = spec.seated ? 0.5 : 0;
  const skin = kit.lambert(spec.skin);
  const bodyMat = kit.lambert(spec.body);
  const hairMat = kit.lambert(spec.hair);
  const accent = kit.lambert(spec.accent);

  if (!spec.seated) {
    const legMat = kit.lambert(spec.legs);
    rig.add(kit.cyl(0.13, 0.11, 0.8, 6, legMat, -0.16, 0.4, 0));
    rig.add(kit.cyl(0.13, 0.11, 0.8, 6, legMat, 0.16, 0.4, 0));
  }

  const torso = new THREE.Group();
  torso.position.y = 0.75 - seatDrop;
  rig.add(torso);
  const body = new THREE.Mesh(kit.geo('capsule', () => new THREE.CapsuleGeometry(0.38, 0.55, 3, 8)), bodyMat);
  body.position.y = 0.66;
  torso.add(body);
  // Arms
  const arm = kit.geo('arm', () => new THREE.CapsuleGeometry(0.1, 0.5, 2, 6));
  const armL = new THREE.Mesh(arm, bodyMat);
  armL.position.set(-0.46, 0.62, 0);
  armL.rotation.z = 0.18;
  const armR = armL.clone();
  armR.position.x = 0.46;
  armR.rotation.z = -0.18;
  torso.add(armL, armR);

  const head = new THREE.Group();
  head.position.y = 1.6;
  torso.add(head);
  head.add(kit.sphere(0.32, 1, skin));
  // Hair cap
  const hairCap = new THREE.Mesh(
    kit.geo('haircap', () => new THREE.SphereGeometry(0.345, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    hairMat,
  );
  hairCap.position.y = 0.04;
  hairCap.rotation.x = -0.25;
  head.add(hairCap);
  if (spec.hairStyle === 'bun') head.add(kit.sphere(0.15, 0, hairMat, 0, 0.32, -0.2));
  if (spec.hairStyle === 'long') head.add(kit.box(0.6, 0.5, 0.18, hairMat, 0, -0.15, -0.22));
  // Eyes
  const eyeMat = kit.lambert(0x1d2421);
  head.add(kit.sphere(0.04, 0, eyeMat, -0.11, 0.02, 0.29), kit.sphere(0.04, 0, eyeMat, 0.11, 0.02, 0.29));

  switch (spec.accessory) {
    case 'cap': {
      head.add(kit.cyl(0.35, 0.36, 0.14, 10, accent, 0, 0.26, 0));
      const brim = kit.box(0.42, 0.04, 0.3, accent, 0, 0.21, 0.32);
      head.add(brim);
      break;
    }
    case 'tie':
      torso.add(kit.box(0.11, 0.42, 0.06, accent, 0, 0.78, 0.37));
      torso.add(kit.box(0.34, 0.08, 0.1, kit.lambert(0xf2f2ee), 0, 1.05, 0.31));
      break;
    case 'backpack':
      torso.add(kit.box(0.52, 0.6, 0.26, accent, 0, 0.7, -0.42));
      break;
    case 'headphones': {
      const band = new THREE.Mesh(kit.geo('band', () => new THREE.TorusGeometry(0.37, 0.045, 5, 12, Math.PI)), accent);
      band.position.y = 0.02;
      head.add(band);
      head.add(kit.cyl(0.12, 0.12, 0.1, 8, accent, -0.37, 0.0, 0).rotateZ(Math.PI / 2));
      head.add(kit.cyl(0.12, 0.12, 0.1, 8, accent, 0.37, 0.0, 0).rotateZ(Math.PI / 2));
      break;
    }
    case 'lanyard': {
      // Neck strap and staff pass, the badge of event and community teams
      const strap = new THREE.Mesh(kit.geo('strap', () => new THREE.TorusGeometry(0.24, 0.025, 4, 12, Math.PI)), accent);
      strap.position.set(0, 1.05, 0.3);
      strap.rotation.set(0, 0, Math.PI);
      torso.add(strap);
      torso.add(kit.box(0.2, 0.26, 0.04, kit.lambert(0xffffff), 0, 0.72, 0.4));
      torso.add(kit.box(0.2, 0.07, 0.045, accent, 0, 0.81, 0.405));
      break;
    }
    case 'glasses': {
      const lens = kit.geo('lens', () => new THREE.TorusGeometry(0.085, 0.022, 4, 10));
      const l = new THREE.Mesh(lens, accent);
      l.position.set(-0.12, 0.03, 0.31);
      const r = l.clone();
      r.position.x = 0.12;
      head.add(l, r, kit.box(0.08, 0.02, 0.02, accent, 0, 0.04, 0.32));
      break;
    }
  }

  // Blob shadow (cheaper than real-time shadows)
  const shadow = new THREE.Mesh(
    kit.geo('blob', () => new THREE.CircleGeometry(0.55, 12).rotateX(-Math.PI / 2)),
    kit.basic(0x0b1a15, { opacity: 0.22 }),
  );
  shadow.position.y = 0.02;
  group.add(shadow);

  // Speech bubble with three dots, shown while talking
  const topY = 2.95 - seatDrop;
  const bubble = new THREE.Group();
  bubble.position.y = topY;
  const bubbleMat = kit.basic(0xffffff);
  bubble.add(kit.box(0.82, 0.42, 0.06, bubbleMat));
  const tail = kit.cyl(0.0, 0.1, 0.18, 4, bubbleMat, -0.18, -0.26, 0);
  tail.rotation.x = Math.PI;
  bubble.add(tail);
  const dotMat = kit.basic(0x1d5c50);
  const dots = [-0.22, 0, 0.22].map((x) => {
    const d = kit.sphere(0.065, 0, dotMat, x, 0, 0.05);
    bubble.add(d);
    return d;
  });
  bubble.visible = false;
  group.add(bubble);

  const phase = Math.random() * 10;
  return {
    group,
    topY,
    update(t, talking, motion, camera) {
      bubble.visible = talking;
      if (talking) {
        bubble.quaternion.copy(camera.quaternion);
        // Undo the parent's rotation so the bubble faces the camera.
        group.getWorldQuaternion(TMP_Q).invert();
        bubble.quaternion.premultiply(TMP_Q);
        dots.forEach((d, i) => (d.position.y = motion ? Math.max(0, Math.sin(t * 7 - i * 0.9)) * 0.07 : 0));
      }
      if (!motion) {
        rig.position.y = 0;
        rig.rotation.z = 0;
        head.rotation.set(0, 0, 0);
        return;
      }
      const tt = t + phase;
      rig.position.y = Math.sin(tt * 2.1) * 0.025;
      rig.rotation.z = Math.sin(tt * 0.9) * 0.025;
      head.rotation.x = talking ? Math.sin(tt * 6) * 0.06 : Math.sin(tt * 0.7) * 0.04;
      head.rotation.y = Math.sin(tt * 0.5) * 0.12;
    },
  };
}

export const CHARACTERS: Record<'guide' | 'resort' | 'policy' | 'foundation' | 'workforce', CharacterSpec> = {
  guide: { body: 0x2e6b5e, legs: 0x2a3a36, skin: 0xc68c62, hair: 0x2a1d17, accessory: 'cap', accent: 0xe3a21a },
  // Priya, CSR Communications Manager: coral blazer and a staff lanyard
  resort: { body: 0xd9694c, legs: 0x2f3b45, skin: 0x9a6446, hair: 0x1a1210, accessory: 'lanyard', accent: 0x2f6f6a, hairStyle: 'long' },
  // Daniel, International Policy Advisor: navy suit and tie
  policy: { body: 0x34465e, legs: 0x26303f, skin: 0xe2b38f, hair: 0x3b2a20, accessory: 'tie', accent: 0x5f9e6e },
  // Grace, VP Community Programmes: plum cardigan and glasses
  foundation: { body: 0x8c3b4a, legs: 0x3d3a3a, skin: 0xe8c3a0, hair: 0x2a1d17, accessory: 'glasses', accent: 0x2b2b2b, hairStyle: 'bun' },
  // Marcus, Head of Workforce Strategy: charcoal jacket and a mustard tie
  workforce: { body: 0x3a4148, legs: 0x23282d, skin: 0x7a4e34, hair: 0x15110f, accessory: 'tie', accent: 0xe3a21a },
};
