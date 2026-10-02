// electron-builder afterPack hook: runs on the packed app, before signing, so
// the signature covers the bundle as it ships.
//
// Removes SwiftShader, Chromium's software Vulkan (about 16 MB). Chromium only
// loads it for WebGL without a usable GPU, and only with
// --enable-unsafe-swiftshader. The PostPile window draws plain HTML and CSS: no
// WebGL, no canvas. Without a GPU (or with --disable-gpu) Chromium composites
// in software, which needs no SwiftShader either.
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const SWIFTSHADER_FILES = ['libvk_swiftshader.dylib', 'vk_swiftshader_icd.json'];

export default async function afterPack(context) {
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const libraries = join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries');
  for (const file of SWIFTSHADER_FILES) {
    const path = join(libraries, file);
    // A newer Electron may move or rename them: say so, but don't fail a release over it.
    if (!existsSync(path)) {
      console.warn(`after-pack: ${path} not found, nothing removed`);
      continue;
    }
    await rm(path);
  }
}
