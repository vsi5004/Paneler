"use client";

import {
  NoColorSpace,
  RepeatWrapping,
  type Texture,
  TextureLoader,
} from "three";

const NORMAL_MAP_URL = "/textures/suede_normal.png";
const ROUGHNESS_MAP_URL = "/textures/suede_roughness.png";
const TEXTURE_REPEAT = 0.2;

// Lazy singletons — the textures are large (~14 MB combined) so we only load
// them once across the whole app and share the same Texture instances between
// every panel material.
let normalMap: Promise<Texture> | null = null;
let roughnessMap: Promise<Texture> | null = null;

function loadTexture(url: string, opts: { isNormal?: boolean }): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const loader = new TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.wrapS = tex.wrapT = RepeatWrapping;
        tex.repeat.set(TEXTURE_REPEAT, TEXTURE_REPEAT);
        if (opts.isNormal) tex.colorSpace = NoColorSpace;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      (err) => reject(err),
    );
  });
}

export function loadSuedeTextures(): Promise<{ normal: Texture; roughness: Texture }> {
  if (!normalMap) normalMap = loadTexture(NORMAL_MAP_URL, { isNormal: true });
  if (!roughnessMap) roughnessMap = loadTexture(ROUGHNESS_MAP_URL, {});
  return Promise.all([normalMap, roughnessMap]).then(([normal, roughness]) => ({
    normal,
    roughness,
  }));
}
