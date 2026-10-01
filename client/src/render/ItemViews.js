// ItemViews – syncs prop meshes with simulation items (pooled by id).
import * as THREE from 'three';
import { buildItemMesh, buildTableDebris } from './ItemMeshes.js';

export class ItemViews {
  constructor(scene) { this.scene = scene; this.map = new Map(); }

  sync(items) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let v = this.map.get(it.id);
      if (!v) {
        const mesh = buildItemMesh(it.type);
        const root = new THREE.Group(); root.add(mesh);
        this.scene.add(root);
        v = { root, mesh, type: it.type, broken: false };
        this.map.set(it.id, v);
      }
      if (it.broken && !v.broken) {
        v.broken = true; v.mesh.visible = false;
        if (it.type === 'table') { v.debris = buildTableDebris(); v.root.add(v.debris); }
      }
      v.root.visible = it.holder == null;
      v.root.position.set(it.x, it.y, it.z);
      v.root.rotation.set(0, it.yaw || 0, 0);
      if (!v.broken) {
        if (it.type === 'table') v.mesh.rotation.set(it.upright ? 0 : Math.PI / 2, 0, 0);
        else v.mesh.rotation.set(it.roll || 0, 0, 0);
        if (it.type === 'kendo_stick' || it.type === 'chair') {
          // lie flat when resting on the ground
          if (it.type === 'kendo_stick') v.mesh.rotation.x = Math.PI / 2 + (it.roll || 0);
        }
      }
    }
    for (const [id, v] of this.map) if (!seen.has(id)) { v.root.removeFromParent(); this.map.delete(id); }
  }

  clear() { for (const v of this.map.values()) v.root.removeFromParent(); this.map.clear(); }
}
