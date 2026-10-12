import * as THREE from 'three';
import type { Kit } from './kit';

/**
 * Ambient life around the plaza: falling leaves, pollen by day and fireflies by night,
 * stars, drifting clouds and fountain spray. Everything is generated in code and
 * instanced or drawn as points, so it adds only a handful of draw calls.
 */
export interface Atmosphere {
  group: THREE.Group;
  update(t: number, dt: number, motion: boolean): void;
  theme(dark: boolean): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Soft round glow drawn on a canvas, used as the sprite for every point. */
function glowTexture(kit: Kit) {
  return kit.canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Points that twinkle: each point has its own phase, speed and size. */
function twinkleMaterial(kit: Kit, map: THREE.Texture, color: number, size: number) {
  return kit.track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        map: { value: map },
        color: { value: new THREE.Color(color) },
        time: { value: 0 },
        size: { value: size },
        strength: { value: 1 },
        pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: `
        attribute float phase;
        uniform float time; uniform float size; uniform float pixelRatio;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float blink = 0.5 + 0.5 * sin(time * (0.8 + fract(phase * 7.13) * 1.6) + phase * 6.2831);
          vAlpha = blink;
          gl_PointSize = size * pixelRatio * (0.6 + 0.6 * blink) * (60.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 color; uniform float strength;
        varying float vAlpha;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vAlpha * strength;
          if (a < 0.01) discard;
          gl_FragColor = vec4(color * a, a);
        }`,
    }),
  );
}

export function buildAtmosphere(kit: Kit, lowPower: boolean): Atmosphere {
  const group = new THREE.Group();
  const glow = glowTexture(kit);

  // ---- Falling leaves and petals ----------------------------------------------
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, -0.22);
  leafShape.quadraticCurveTo(0.17, 0, 0, 0.22);
  leafShape.quadraticCurveTo(-0.17, 0, 0, -0.22);
  const leafGeo = kit.geo('leafshape', () => new THREE.ShapeGeometry(leafShape, 3));
  const leafCount = lowPower ? 45 : 110;
  const leaves = new THREE.InstancedMesh(leafGeo, kit.lambert(0xffffff, { side: THREE.DoubleSide }), leafCount);
  const leafColors = [0xe3a21a, 0xd9694c, 0x8fbf6a, 0xf2c14e, 0xc4462a, 0x6fae6a];
  const col = new THREE.Color();
  const L = Array.from({ length: leafCount }, (_, i) => {
    leaves.setColorAt(i, col.set(leafColors[i % leafColors.length]));
    return {
      p: new THREE.Vector3(rand(-38, 38), rand(0, 26), rand(-38, 38)),
      fall: rand(0.7, 1.4),
      sway: rand(0.6, 1.4),
      phase: rand(0, 10),
      spin: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)),
      rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
      scale: rand(0.8, 1.4),
    };
  });
  leaves.frustumCulled = false;
  group.add(leaves);
  const tmp = new THREE.Object3D();
  const placeLeaves = () => {
    L.forEach((l, i) => {
      tmp.position.copy(l.p);
      tmp.rotation.copy(l.rot);
      tmp.scale.setScalar(l.scale);
      tmp.updateMatrix();
      leaves.setMatrixAt(i, tmp.matrix);
    });
    leaves.instanceMatrix.needsUpdate = true;
  };
  placeLeaves();

  // ---- Pollen (day) / fireflies (night) ------------------------------------------
  const moteCount = lowPower ? 60 : 140;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(moteCount * 3);
  const moteBase = new Float32Array(moteCount * 3);
  const motePhase = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(6, 34);
    moteBase.set([Math.sin(a) * r, rand(0.6, 6), Math.cos(a) * r], i * 3);
    motePhase[i] = Math.random();
  }
  motePos.set(moteBase);
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('phase', new THREE.BufferAttribute(motePhase, 1));
  kit.track(moteGeo);
  const moteMat = twinkleMaterial(kit, glow, 0xfff1b8, 7);
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  group.add(motes);

  // ---- Stars (night only) ---------------------------------------------------------
  const starCount = 420;
  const starPos = new Float32Array(starCount * 3);
  const starPhase = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = rand(0.12, 1);
    const r = 270;
    starPos.set([Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r], i * 3);
    starPhase[i] = Math.random();
  }
  const starGeo = kit.track(new THREE.BufferGeometry());
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('phase', new THREE.BufferAttribute(starPhase, 1));
  const starMat = twinkleMaterial(kit, glow, 0xdfe8ff, 14);
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  // ---- Clouds ------------------------------------------------------------------------
  const cloudMat = kit.lambert(0xffffff, { unique: true });
  const clouds = Array.from({ length: lowPower ? 5 : 8 }, (_, i) => {
    const c = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let k = 0; k < puffs; k++) {
      const s = rand(3, 5.5);
      const puff = kit.sphere(1, 1, cloudMat, (k - puffs / 2) * 3.2, rand(-0.6, 0.8), rand(-1.5, 1.5));
      puff.scale.set(s * 1.25, s * 0.75, s);
      c.add(puff);
    }
    const angle = (i / 8) * Math.PI * 2;
    c.userData = { angle, radius: rand(70, 130), y: rand(38, 58), speed: rand(0.006, 0.014) };
    c.position.set(Math.sin(angle) * c.userData.radius, c.userData.y, Math.cos(angle) * c.userData.radius);
    group.add(c);
    return c;
  });

  // ---- Fountain spray ---------------------------------------------------------------
  const sprayCount = lowPower ? 40 : 90;
  const sprayPos = new Float32Array(sprayCount * 3);
  const sprayPhase = new Float32Array(sprayCount);
  const sprayAngle = new Float32Array(sprayCount);
  for (let i = 0; i < sprayCount; i++) {
    sprayPhase[i] = Math.random();
    sprayAngle[i] = Math.random() * Math.PI * 2;
  }
  const sprayGeo = kit.track(new THREE.BufferGeometry());
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  sprayGeo.setAttribute('phase', new THREE.BufferAttribute(sprayPhase, 1));
  const sprayMat = twinkleMaterial(kit, glow, 0xbfefff, 3.2);
  const spray = new THREE.Points(sprayGeo, sprayMat);
  spray.frustumCulled = false;
  group.add(spray);
  const placeSpray = (t: number) => {
    for (let i = 0; i < sprayCount; i++) {
      // Each droplet leaves the top bowl's rim, arcs outward and drops into the basin.
      const k = (t * 0.55 + sprayPhase[i]) % 1;
      const r = 1.12 + k * 1.3;
      const y = 3.45 + k * 0.5 - k * k * 2.9;
      sprayPos[i * 3] = Math.sin(sprayAngle[i]) * r;
      sprayPos[i * 3 + 1] = Math.max(1.05, y);
      sprayPos[i * 3 + 2] = Math.cos(sprayAngle[i]) * r;
    }
    sprayGeo.attributes.position.needsUpdate = true;
  };
  placeSpray(0);

  let dark = false;
  const wind = new THREE.Vector3(0.9, 0, 0.35);

  return {
    group,
    theme(isDark) {
      dark = isDark;
      stars.visible = isDark;
      moteMat.uniforms.color.value.set(isDark ? 0xd8ff7a : 0xfff1b8);
      moteMat.uniforms.size.value = isDark ? 9 : 5;
      moteMat.uniforms.strength.value = isDark ? 1 : 0.55;
      cloudMat.color.set(isDark ? 0x4a5a74 : 0xffffff);
      cloudMat.emissive.set(isDark ? 0x0b1220 : 0x2a2018);
    },
    update(t, dt, motion) {
      moteMat.uniforms.time.value = t;
      starMat.uniforms.time.value = t;
      sprayMat.uniforms.time.value = t * 3;
      if (!motion) return;

      // Leaves tumble down on a gentle wind and start again from the top.
      const gust = 0.6 + 0.4 * Math.sin(t * 0.3);
      for (const l of L) {
        l.p.y -= l.fall * dt;
        l.p.x += (wind.x * gust + Math.sin(t * l.sway + l.phase) * 0.8) * dt;
        l.p.z += (wind.z * gust + Math.cos(t * l.sway * 0.7 + l.phase) * 0.6) * dt;
        l.rot.x += l.spin.x * dt;
        l.rot.y += l.spin.y * dt;
        l.rot.z += l.spin.z * dt;
        if (l.p.y < 0.05 || Math.abs(l.p.x) > 45 || Math.abs(l.p.z) > 45) {
          l.p.set(rand(-40, 30), rand(18, 28), rand(-40, 36));
        }
      }
      placeLeaves();

      // Motes drift in slow loops.
      for (let i = 0; i < moteCount; i++) {
        const ph = motePhase[i] * 20;
        motePos[i * 3] = moteBase[i * 3] + Math.sin(t * 0.4 + ph) * 1.4;
        motePos[i * 3 + 1] = moteBase[i * 3 + 1] + Math.sin(t * 0.7 + ph * 1.3) * (dark ? 0.9 : 0.5);
        motePos[i * 3 + 2] = moteBase[i * 3 + 2] + Math.cos(t * 0.35 + ph) * 1.4;
      }
      moteGeo.attributes.position.needsUpdate = true;

      for (const c of clouds) {
        const u = c.userData as { angle: number; radius: number; y: number; speed: number };
        u.angle += u.speed * dt;
        c.position.set(Math.sin(u.angle) * u.radius, u.y, Math.cos(u.angle) * u.radius);
        c.rotation.y = -u.angle;
      }
      placeSpray(t);
    },
  };
}
