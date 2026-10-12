import './style.css';
import { App } from './ui/app';
import { SimpleWorld } from './world/simple';
import type { World } from './world/types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function start() {
  const canvas = $('scene') as HTMLCanvasElement;
  const veil = $('veil');
  const toSimple = (): World => {
    document.body.classList.add('simple');
    canvas.hidden = true;
    return new SimpleWorld(veil);
  };

  let world: World;
  let webglFailed = false;
  try {
    const { World3D } = await import('./world/three/world3d');
    world = new World3D(canvas, veil);
  } catch (err) {
    console.warn('3D scene could not start, using Simple mode.', err);
    webglFailed = true;
    world = toSimple();
  }

  new App({ hud: $('hud'), stage: $('stage'), live: $('live'), floats: $('floats') }, { world, webglFailed, toSimple });
}

void start();
