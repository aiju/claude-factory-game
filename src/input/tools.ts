// Tools: select, place, demolish. Tools build commands; the sim validates.

import * as THREE from 'three';
import { BUILDINGS, BUILD_BAR, type BuildingTypeId } from '../data/buildings';
import { SNAP } from '../data/tunables';
import type { Game } from '../game';
import type { CameraRig } from '../render/camera-rig';
import type { GhostView } from '../render/ghost';
import { pickGround, screenRay } from '../render/picking';
import type { WorldView } from '../render/world-view';
import { buildingAt, validatePlacement } from '../sim/build';
import { isTyping } from './camera-controls';
import { snapPose, type Pose } from './snap';

export type Tool = { kind: 'select' } | { kind: 'place'; type: BuildingTypeId } | { kind: 'demolish' };

export interface ToolState {
  tool: Tool;
  selected: number | null;
  hover: number | null;
  /** Placement: snapped pose, validity, reason. */
  pose: Pose | null;
  valid: boolean;
  reason: string;
}

export class Tools {
  st: ToolState = { tool: { kind: 'select' }, selected: null, hover: null, pose: null, valid: false, reason: '' };
  /** Raw (unsnapped) rotation for placement; R and right-drag change it. */
  private rawRot = 0;
  private rotDrag: { x: number; moved: boolean } | null = null;
  private lastPointer = { x: 0, y: 0, shift: false, valid: false };
  onChange: () => void = () => {};
  onMessage: (text: string) => void = () => {};

  constructor(
    private el: HTMLElement,
    private game: Game,
    private rig: CameraRig,
    private view: WorldView,
    private ghost: GhostView,
  ) {
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.refreshGhost(false);
    });
  }

  wantsRightDrag(): boolean {
    return this.st.tool.kind === 'place';
  }

  setTool(tool: Tool) {
    this.st.tool = tool;
    this.rotDrag = null;
    this.view.doomed = null;
    this.st.hover = null;
    if (tool.kind !== 'place') {
      this.ghost.hide();
      this.st.pose = null;
    } else {
      this.refreshGhost(this.lastPointer.shift);
    }
    this.onChange();
  }

  select(id: number | null) {
    this.st.selected = id;
    this.view.selected = id;
    this.onChange();
  }

  private ground(clientX: number, clientY: number): THREE.Vector3 | null {
    return pickGround(this.game.sim.d.terrain, screenRay(this.rig.camera, this.el, clientX, clientY));
  }

  private pickBuilding(clientX: number, clientY: number): number | null {
    const ray = new THREE.Raycaster();
    ray.ray.copy(screenRay(this.rig.camera, this.el, clientX, clientY));
    const hit = ray.intersectObjects(this.view.pickableMeshes(), false)[0];
    if (hit) return hit.object.userData.buildingId ?? null;
    const p = this.ground(clientX, clientY);
    return p ? (buildingAt(this.game.sim, p.x, p.z)?.id ?? null) : null;
  }

  private onMove(e: PointerEvent) {
    this.lastPointer = { x: e.clientX, y: e.clientY, shift: e.shiftKey, valid: true };
    if (this.rotDrag) {
      const dx = e.clientX - this.rotDrag.x;
      if (Math.abs(dx) > 2) this.rotDrag.moved = true;
      this.rawRot -= dx * 0.012;
      this.rotDrag.x = e.clientX;
      this.refreshGhost(e.shiftKey, false);
      return;
    }
    if (this.st.tool.kind === 'place') this.refreshGhost(e.shiftKey);
    else {
      const h = this.pickBuilding(e.clientX, e.clientY);
      if (h !== this.st.hover) {
        this.st.hover = h;
        this.view.doomed = this.st.tool.kind === 'demolish' ? h : null;
        this.onChange();
      }
    }
  }

  /** Recompute the ghost pose. `follow`: move it to the pointer (false while rotating). */
  refreshGhost(shift: boolean, follow = true) {
    if (this.st.tool.kind !== 'place' || !this.lastPointer.valid) return;
    const type = this.st.tool.type;
    let x = this.st.pose?.x ?? 0;
    let z = this.st.pose?.z ?? 0;
    if (follow || !this.st.pose) {
      const p = this.ground(this.lastPointer.x, this.lastPointer.y);
      if (!p) {
        this.ghost.hide();
        return;
      }
      x = p.x;
      z = p.z;
      this.anchor = { x, z };
    } else if (this.anchor) {
      x = this.anchor.x;
      z = this.anchor.z;
    }
    const pose = snapPose(this.game.sim, type, { x, z, rot: this.rawRot }, !shift);
    const v = validatePlacement(this.game.sim, type, pose.x, pose.z, pose.rot);
    this.st.pose = pose;
    this.st.valid = v.ok;
    this.st.reason = v.ok ? '' : v.reason;
    this.ghost.show(type, pose.x, pose.z, pose.rot, v.ok);
    this.onChange();
  }
  private anchor: { x: number; z: number } | null = null;

  private onDown(e: PointerEvent) {
    if (e.button === 2 && this.st.tool.kind === 'place') {
      this.rotDrag = { x: e.clientX, moved: false };
      return;
    }
    if (e.button !== 0) return;
    const t = this.st.tool;
    if (t.kind === 'place') {
      this.refreshGhost(e.shiftKey);
      if (!this.st.pose) return;
      if (!this.st.valid) {
        this.onMessage(this.st.reason);
        return;
      }
      const res = this.game.command({ type: 'place', building: t.type, x: this.st.pose.x, z: this.st.pose.z, rot: this.st.pose.rot });
      if (!res.ok) this.onMessage(res.reason);
      this.refreshGhost(e.shiftKey);
    } else if (t.kind === 'demolish') {
      const id = this.pickBuilding(e.clientX, e.clientY);
      if (id === null) return;
      const res = this.game.command({ type: 'demolish', id });
      if (!res.ok) this.onMessage(res.reason);
      if (this.st.selected === id) this.select(null);
      this.st.hover = null;
      this.view.doomed = null;
      this.onChange();
    } else {
      this.select(this.pickBuilding(e.clientX, e.clientY));
    }
  }

  private onUp(e: PointerEvent) {
    if (e.button === 2 && this.rotDrag) {
      const moved = this.rotDrag.moved;
      this.rotDrag = null;
      // A right-click without a drag cancels placement.
      if (!moved) this.setTool({ kind: 'select' });
    }
  }

  private onKey(e: KeyboardEvent) {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') {
      if (this.st.tool.kind !== 'select') this.setTool({ kind: 'select' });
      else this.select(null);
      return;
    }
    if (e.code === 'KeyR' && this.st.tool.kind === 'place') {
      this.rawRot = Math.round(this.rawRot / SNAP.rotStep) * SNAP.rotStep + (e.shiftKey ? 1 : -1) * SNAP.rotStep;
      this.refreshGhost(false, false);
      return;
    }
    if (e.code === 'KeyX') {
      this.setTool(this.st.tool.kind === 'demolish' ? { kind: 'select' } : { kind: 'demolish' });
      return;
    }
    if (e.code === 'Delete' && this.st.selected !== null) {
      const res = this.game.command({ type: 'demolish', id: this.st.selected });
      if (!res.ok) this.onMessage(res.reason);
      else this.select(null);
      return;
    }
    for (const type of BUILD_BAR) {
      if (BUILDINGS[type].hotkey && e.key === BUILDINGS[type].hotkey) {
        const same = this.st.tool.kind === 'place' && this.st.tool.type === type;
        this.setTool(same ? { kind: 'select' } : { kind: 'place', type });
        return;
      }
    }
  }
}
