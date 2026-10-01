// Asset pipeline: takes the original Tripo character GLBs from assets/source/
// and produces game-ready versions in client/public/assets/characters/.
//  - welds + simplifies the mesh (~160k tris -> ~35k tris)
//  - resizes textures to 1024px and re-encodes them (jpeg/webp)
//  - strips unsupported extensions (FB_ngon_encoding, KHR_materials_volume)
// Originals are never modified. Re-run with `npm run assets`.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets/source');
const OUT = path.join(ROOT, 'client/public/assets/characters');
const TARGET_TRIS = Number(process.env.TARGET_TRIS || 36000);
const TEX_SIZE = Number(process.env.TEX_SIZE || 1024);

// source file name -> character id used by the game
const MAP = { max: 'max', masked: 'masked', ajan: 'ajan', rize: 'rise', cave: 'cave', rot: 'rot', lucky: 'lucky' };

fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const [file, id] of Object.entries(MAP)) {
  const src = path.join(SRC, `${file}.glb`);
  if (!fs.existsSync(src)) { console.warn('missing', src); continue; }
  const doc = await io.read(src);
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (['FB_ngon_encoding', 'KHR_materials_volume', 'KHR_materials_transmission'].includes(ext.extensionName)) ext.dispose();
  }
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  const ratio = Math.min(1, TARGET_TRIS / tris);
  await doc.transform(
    weld({}),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 }),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX_SIZE, TEX_SIZE], quality: 82 }),
  );
  let outTris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) outTris += (p.getIndices()?.getCount() ?? 0) / 3;
  const dst = path.join(OUT, `${id}.glb`);
  await io.write(dst, doc);
  console.log(`${file} -> ${id}.glb  tris ${tris} -> ${outTris}  ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB`);
}
