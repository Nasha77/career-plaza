import { learnSwatches, modelOf, recolourPortrait, variantOf } from '../world/cast';

/**
 * Small portraits for the talk box name tags, from Kenney's preview pictures. Recoloured looks
 * get a recoloured copy so the portrait matches the person in the room.
 */

const BASE = `${import.meta.env.BASE_URL}models/characters/`;
const cache = new Map<string, string>();
let swatches: Promise<void> | null = null;

const preview = (look: string) => `${BASE}previews/${modelOf(look)}.png`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Get the portraits for these looks ready (call on entering a building). */
export async function preparePortraits(looks: string[]): Promise<void> {
  try {
    swatches ??= loadImage(`${BASE}Textures/colormap.png`).then(learnSwatches);
    await swatches;
    await Promise.all(
      looks.map(async (look) => {
        if (cache.has(look)) return;
        const v = variantOf(look);
        cache.set(look, v ? recolourPortrait(await loadImage(preview(look)), v) : preview(look));
      }),
    );
  } catch {
    /* fall back to the plain previews */
  }
}

export const portraitFor = (look: string) => cache.get(look) ?? preview(look);
