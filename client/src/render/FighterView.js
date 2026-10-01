// FighterView – the visual for one wrestler: auto-rigged GLB instance driven
// by the Animator, body transform (falls/spins), held items, hit jolts.
import * as THREE from 'three';
import { getCharacter } from '@shared/config/characters.js';
import { S } from '@shared/sim/constants.js';
import { PoseSolver, P } from '../anim/PoseSolver.js';
import { Animator } from '../anim/Animator.js';
import { buildItemMesh, HOLD_OFFSETS } from './ItemMeshes.js';

const _v = new THREE.Vector3();

export class FighterView {
  constructor(assets, charId, { teamColor = null } = {}) {
    this.charId = charId;
    this.c = getCharacter(charId);
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.model = new THREE.Group();
    this.root.add(this.pivot); this.pivot.add(this.model);
    const inst = assets.instance(charId);
    this.inst = inst;
    this.mesh = inst.mesh;
    this.model.add(this.mesh);
    this.solver = new PoseSolver(inst);
    this.scale = this.c.height / inst.joints.headTop.y;
    this.model.scale.setScalar(this.scale);
    this.pelvisH = inst.joints.hips.y * this.scale;
    this.model.position.y = -this.pelvisH;
    this.thick = Math.max(0.12, this.c.radius * 0.45);
    this.anim = new Animator(this.solver, this.c);
    this.heldItem = null; this.heldType = null;
    this.teamRing = this.makeTeamRing(teamColor);
    this.root.add(this.teamRing);
    this.visibleWanted = true;
    this.lastHp = null;
  }

  makeTeamRing(color) {
    const g = new THREE.RingGeometry(this.c.radius * 1.05, this.c.radius * 1.25, 40);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: color || 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    const r = new THREE.Mesh(g, m); r.position.y = 0.012; r.renderOrder = 2;
    r.visible = !!color;
    return r;
  }

  setTeamColor(color, show = true) { this.teamRing.material.color.set(color); this.teamRing.visible = show; }

  /** Hand world position (for effects / held items). */
  handWorld(side = 'R', out = new THREE.Vector3()) {
    const b = this.inst.bones['hand_' + side];
    return b.getWorldPosition(out);
  }

  holdItem(type) {
    if (this.heldType === type) return;
    if (this.heldItem) { this.heldItem.removeFromParent(); this.heldItem = null; }
    this.heldType = type;
    if (!type) return;
    const m = buildItemMesh(type);
    const off = HOLD_OFFSETS[type] || { pos: [0, 0, 0], rot: [0, 0, 0] };
    m.position.set(...off.pos).multiplyScalar(1 / this.scale);
    m.rotation.set(...off.rot);
    m.scale.setScalar(1 / this.scale);
    this.inst.bones.hand_R.add(m);
    this.heldItem = m;
  }

  /** Called on a landed hit – physical jolt in the push direction (world). */
  onHit(dirX, dirZ, strength = 1) {
    const yaw = this.root.rotation.y;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const lf = dirX * sy + dirZ * cy, ll = dirX * cy - dirZ * sy;
    this.anim.impulse(ll, lf, strength);
  }

  /** v: fighter view-state (sim fighter or decoded snapshot). */
  update(dt, v) {
    this.root.visible = !v.hidden;
    if (v.hidden) return;
    this.root.position.set(v.x, v.y, v.z);
    this.root.rotation.y = v.yaw;
    const pose = this.anim.update(dt, v);
    this.solver.apply(pose);
    // body transform: tilt around the pelvis, drop toward the floor, spins, hops
    const drop = Math.max(0, Math.min(1, pose[P.drop]));
    this.pivot.position.y = this.pelvisH + (this.thick - this.pelvisH) * drop + pose[P.lift] * this.c.height;
    this.pivot.rotation.set(pose[P.tilt], pose[P.bodyYaw], pose[P.tilt + 1], 'YXZ');
    this.teamRing.visible = this.teamRing.visible && v.state !== S.KO;
    this.holdItem(v.itemType || null);
  }

  dispose() {
    this.root.removeFromParent();
    this.mesh.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
  }
}
