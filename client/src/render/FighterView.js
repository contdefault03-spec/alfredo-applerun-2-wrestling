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
    this.contact = this.makeContactShadow();
    this.visibleWanted = true;
    this.lastHp = null;
  }

  /** Swap the rendered model (e.g. Max's coat entrance model → normal Max). */
  swapModel(assets, key) {
    const inst = assets.instance(key);
    if (!inst) return false;
    if (this.mesh) this.model.remove(this.mesh);
    this.inst = inst; this.mesh = inst.mesh; this.model.add(this.mesh);
    this.solver = new PoseSolver(inst);
    this.scale = this.c.height / inst.joints.headTop.y;
    this.model.scale.setScalar(this.scale);
    this.pelvisH = inst.joints.hips.y * this.scale;
    this.model.position.y = -this.pelvisH;
    this.anim = new Animator(this.solver, this.c);
    return true;
  }

  /** Soft contact shadow – grounds the wrestler even with low-res shadow maps. */
  makeContactShadow() {
    if (!FighterView.shadowTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      FighterView.shadowTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: FighterView.shadowTex, transparent: true, depthWrite: false, opacity: 0.8 }));
    m.renderOrder = 1; m.scale.setScalar(this.c.radius * 3.2);
    return m;
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
    if (v.hidden) { if (this.contact) this.contact.visible = false; return; }
    this.root.position.set(v.x, v.y, v.z);
    this.root.rotation.y = v.yaw;
    const pose = this.anim.update(dt, v);
    this.solver.apply(pose);
    // body transform: tilt around the pelvis, drop toward the floor, spins, hops
    const drop = Math.max(0, Math.min(1, pose[P.drop]));
    this.pivot.position.y = this.pelvisH + (this.thick - this.pelvisH) * drop + pose[P.lift] * this.c.height;
    this.pivot.rotation.set(pose[P.tilt], pose[P.bodyYaw], pose[P.tilt + 1], 'YXZ');
    // contact shadow stays on the surface below; fades/shrinks with height
    if (!this.contact.parent && this.root.parent) this.root.parent.add(this.contact);
    const ground = v.zone === 'floor' ? 0 : (Math.abs(v.x) < 3.7 && Math.abs(v.z) < 3.7 ? 1.2 : 0);
    const hgt = Math.max(0, v.y - ground);
    this.contact.position.set(v.x, ground + 0.012, v.z);
    this.contact.scale.setScalar(this.c.radius * (3.2 + drop * 2.5) * (1 + hgt * 0.25));
    this.contact.material.opacity = 0.8 / (1 + hgt * 1.5);
    this.contact.visible = true;
    this.teamRing.visible = this.teamRing.visible && v.state !== S.KO;
    this.holdItem(v.itemType || null);
    // Ajan's food: shrinks bite by bite while he eats it, gone afterwards
    const prop = this.inst.bones.prop_L;
    if (prop) {
      let k = 1;
      if (v.ateFood) k = 0;
      else if (v.state === S.CELEBRATE && v.sub === 1) k = Math.max(0, 1 - Math.floor(Math.max(0, v.stateTime - 0.5) / 0.75) * 0.25);
      this.propScale = (this.propScale ?? 1) + (k - (this.propScale ?? 1)) * Math.min(1, dt * 10);
      prop.scale.setScalar(Math.max(0.0001, this.propScale));
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.contact.removeFromParent();
    this.mesh.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
  }
}
