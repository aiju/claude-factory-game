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
import { planLink } from '../sim/links';
import { isTyping } from './camera-controls';
import { snapPose, type Pose } from './snap';

export type Tool = { kind: 'select' } | { kind: 'place'; type: BuildingTypeId } | { kind: 'demolish' } | { kind: 'link' };

export interface ToolState {
  tool: Tool;
  selected: number | null;
  hover: number | null;
  /** Placement: snapped pose, validity, reason. */
  pose: Pose | null;
  valid: boolean;
  reason: string;
  /** Link tool: the building a link starts from, and where to show its refusal. */
  linkFrom: number | null;
  labelAt: { x: number; y: number } | null;
  /** A link under the pointer (demolish), and the selected link. */
  hoverLink: number | null;
  selectedLink: number | null;
}

export class Tools {
  st: ToolState = { tool: { kind: 'select' }, selected: null, hover: null, pose: null, valid: false, reason: '', linkFrom: null, labelAt: null, hoverLink: null, selectedLink: null };
  /** Link tool: dragging from a building (released elsewhere makes the link). */
  private linkDrag = false;
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
    this.view.links.doomed = null;
    this.st.hover = null;
    this.st.hoverLink = null;
    this.endLink();
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
    this.st.selectedLink = null;
    this.onChange();
  }

  selectLink(id: number | null) {
    this.st.selected = null;
    this.view.selected = null;
    this.st.selectedLink = id;
    this.onChange();
  }

  private endLink() {
    this.st.linkFrom = null;
    this.st.reason = '';
    this.st.labelAt = null;
    this.linkDrag = false;
    this.view.links.showGhost(null, true);
    if (this.st.tool.kind === 'link') this.view.selected = null;
  }

  private tryLink(from: number, to: number) {
    const res = this.game.command({ type: 'link', from, to });
    if (!res.ok) this.onMessage(res.reason);
    this.endLink();
    this.onChange();
  }

  /** Link tool: show the route from the start building to the one under the pointer. */
  private previewLink(target: number | null, x: number, y: number) {
    const from = this.st.linkFrom;
    if (from === null || target === null || target === from) {
      this.view.links.showGhost(null, true);
      this.st.reason = '';
      this.st.labelAt = null;
      return;
    }
    const plan = planLink(this.game.sim, from, target);
    if (plan.ok) {
      this.view.links.showGhost(plan.path, true, plan.supports);
      this.st.reason = '';
    } else {
      this.view.links.showGhost(plan.path ?? null, false);
      this.st.reason = plan.reason;
    }
    this.st.labelAt = { x, y };
  }

  /** A link (conveyor or arm) under the pointer, if no building is nearer. */
  private pickLink(clientX: number, clientY: number): number | null {
    const ray = new THREE.Raycaster();
    ray.ray.copy(screenRay(this.rig.camera, this.el, clientX, clientY));
    const hits = ray.intersectObjects([...this.view.pickableMeshes(), ...this.view.links.pickable()], false);
    const hit = hits[0];
    return hit ? (hit.object.userData.linkId ?? null) : null;
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
      const link = this.st.tool.kind === 'demolish' ? this.pickLink(e.clientX, e.clientY) : null;
      const h = link === null ? this.pickBuilding(e.clientX, e.clientY) : null;
      if (this.st.tool.kind === 'link') this.previewLink(h, e.clientX, e.clientY);
      if (h !== this.st.hover || link !== this.st.hoverLink) {
        this.st.hover = h;
        this.st.hoverLink = link;
        this.view.doomed = this.st.tool.kind === 'demolish' ? h : null;
        this.view.links.doomed = link;
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
    } else if (t.kind === 'link') {
      const id = this.pickBuilding(e.clientX, e.clientY);
      if (this.st.linkFrom === null) {
        if (id === null) return;
        this.st.linkFrom = id;
        this.view.selected = id;
        this.linkDrag = true;
        this.onChange();
      } else if (id !== null && id !== this.st.linkFrom) this.tryLink(this.st.linkFrom, id);
      else if (id === null) {
        this.endLink();
        this.onChange();
      }
    } else if (t.kind === 'demolish') {
      const link = this.pickLink(e.clientX, e.clientY);
      if (link !== null) {
        const res = this.game.command({ type: 'unlink', id: link });
        if (!res.ok) this.onMessage(res.reason);
        this.st.hoverLink = null;
        this.view.links.doomed = null;
        if (this.st.selectedLink === link) this.selectLink(null);
        this.onChange();
        return;
      }
      const id = this.pickBuilding(e.clientX, e.clientY);
      if (id === null) return;
      const res = this.game.command({ type: 'demolish', id });
      if (!res.ok) this.onMessage(res.reason);
      if (this.st.selected === id) this.select(null);
      this.st.hover = null;
      this.view.doomed = null;
      this.onChange();
    } else {
      const id = this.pickBuilding(e.clientX, e.clientY);
      const link = this.pickLink(e.clientX, e.clientY);
      if (link !== null) this.selectLink(link);
      else this.select(id);
    }
  }

  private onUp(e: PointerEvent) {
    if (e.button === 0 && this.st.tool.kind === 'link' && this.linkDrag) {
      this.linkDrag = false;
      const id = this.pickBuilding(e.clientX, e.clientY);
      // Released on another building: make it. On the same one: wait for a second click.
      if (id !== null && this.st.linkFrom !== null && id !== this.st.linkFrom) this.tryLink(this.st.linkFrom, id);
      return;
    }
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
      if (this.st.tool.kind === 'link' && this.st.linkFrom !== null) {
        this.endLink();
        this.onChange();
      } else if (this.st.tool.kind !== 'select') this.setTool({ kind: 'select' });
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
    if (e.key === '4') {
      this.setTool(this.st.tool.kind === 'link' ? { kind: 'select' } : { kind: 'link' });
      return;
    }
    if (e.code === 'Delete' && this.st.selectedLink !== null) {
      const res = this.game.command({ type: 'unlink', id: this.st.selectedLink });
      if (!res.ok) this.onMessage(res.reason);
      else this.selectLink(null);
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
