// Builds the web game (TypeScript → bundled JS) into web/dist and copies it into the
// native projects so the app can serve it offline.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist');
const MP = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const TARGETS = [
  path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www'),
  path.join(ROOT, 'ios', 'www'),
];

async function main(): Promise<void> {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(DIST, 'lib', 'mediapipe', 'wasm'), { recursive: true });

  await build({
    entryPoints: ['game', 'camera', 'controller'].map((n) => path.join(ROOT, 'web', 'src', `${n}.ts`)),
    outdir: DIST,
    bundle: true,
    format: 'iife',
    target: ['chrome87', 'safari14'],
    minify: process.argv.includes('--minify'),
    sourcemap: !process.argv.includes('--minify'),
    logLevel: 'info',
  });

  await cp(path.join(ROOT, 'web', 'public'), DIST, { recursive: true });
  for (const f of ['vision_wasm_internal', 'vision_wasm_nosimd_internal']) {
    for (const ext of ['js', 'wasm']) await cp(path.join(MP, `${f}.${ext}`), path.join(DIST, 'lib', 'mediapipe', 'wasm', `${f}.${ext}`));
  }

  for (const t of TARGETS) {
    await rm(t, { recursive: true, force: true });
    await cp(DIST, t, { recursive: true });
  }
  console.log(`Web game built → ${path.relative(ROOT, DIST)} (copied into android + ios)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
