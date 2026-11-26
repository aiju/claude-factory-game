// RTS camera controls: WASD/edge-scroll/middle-drag pan, wheel zoom towards
// the cursor, Q/E or right-drag rotate.

import { CAMERA } from '../data/camera';
import type { CameraRig } from '../render/camera-rig';
import { pickGround, pickPlane, screenRay } from '../render/picking';

export interface CameraControlsOptions {
  /** If this returns true, right-drag is left to the active tool. */
  toolWantsRightDrag: () => boolean;
}

export class CameraControls {
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  private middle: { gx: number; gz: number; h: number } | null = null;
  private right: { x: number; y: number; moved: boolean } | null = null;
  edgeScroll = true;
  /** Set after a right-drag that rotated the camera, so tools can ignore the click. */
  rightDragged = false;

  constructor(
    private el: HTMLElement,
    private rig: CameraRig,
    private opts: CameraControlsOptions,
  ) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerenter', () => (this.mouse.inside = true));
    el.addEventListener('pointerleave', () => (this.mouse.inside = false));
    document.addEventListener('mouseleave', () => (this.mouse.inside = false));
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const g = this.rig.goal;
    const factor = Math.pow(CAMERA.zoomStep, Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100 || 1));
    const newDist = Math.min(CAMERA.maxDist, Math.max(CAMERA.minDist, g.dist * factor));
    const k = newDist / g.dist;
    const p = pickGround(this.rig.terrain, screenRay(this.rig.camera, this.el, e.clientX, e.clientY));
    if (p) {
      // Scale the goal about the point under the cursor so it stays put.
      g.x = p.x + (g.x - p.x) * k;
      g.z = p.z + (g.z - p.z) * k;
    }
    g.dist = newDist;
  }

  private onDown(e: PointerEvent) {
    if (e.button === 1) {
      e.preventDefault();
      const h = this.rig.targetY;
      const p = pickPlane(screenRay(this.rig.camera, this.el, e.clientX, e.clientY), h);
      if (p) this.middle = { gx: p.x, gz: p.z, h };
    } else if (e.button === 2) {
      this.rightDragged = false;
      if (!this.opts.toolWantsRightDrag()) this.right = { x: e.clientX, y: e.clientY, moved: false };
    }
  }

  private onMove(e: PointerEvent) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (this.middle) {
      // Grab: keep the grabbed ground point under the cursor. Use the current
      // camera, then move goal and current together so it doesn't lag.
      const p = pickPlane(screenRay(this.rig.camera, this.el, e.clientX, e.clientY), this.middle.h);
      if (p) {
        const dx = this.middle.gx - p.x;
        const dz = this.middle.gz - p.z;
        this.rig.goal.x += dx;
        this.rig.goal.z += dz;
        this.rig.cur.x += dx;
        this.rig.cur.z += dz;
      }
    }
    if (this.right) {
      const dx = e.clientX - this.right.x;
      const dy = e.clientY - this.right.y;
      if (!this.right.moved && Math.hypot(dx, dy) > 4) this.right.moved = true;
      if (this.right.moved) {
        this.rightDragged = true;
        this.rig.goal.yaw -= dx * CAMERA.dragRotate;
        this.rig.goal.pitch += dy * CAMERA.dragRotate;
      }
      this.right.x = e.clientX;
      this.right.y = e.clientY;
    }
  }

  private onUp(e: PointerEvent) {
    if (e.button === 1) this.middle = null;
    if (e.button === 2) this.right = null;
  }

  update(dt: number) {
    const g = this.rig.goal;
    let fx = 0;
    let fz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    if (this.edgeScroll && this.mouse.inside && !this.middle && !this.right) {
      const r = this.el.getBoundingClientRect();
      const m = CAMERA.edgeScrollPx;
      if (this.mouse.x <= r.left + m) fx -= 1;
      if (this.mouse.x >= r.right - m) fx += 1;
      if (this.mouse.y <= r.top + m) fz -= 1;
      if (this.mouse.y >= r.bottom - m) fz += 1;
    }
    if (fx || fz) {
      const len = Math.hypot(fx, fz);
      // Screen-relative: forward is away from the camera along its yaw.
      const speed = CAMERA.panSpeed * g.dist * dt;
      const s = Math.sin(g.yaw);
      const c = Math.cos(g.yaw);
      const wx = (fx * c + fz * s) / len;
      const wz = (-fx * s + fz * c) / len;
      g.x += wx * speed;
      g.z += wz * speed;
    }
    if (this.keys.has('KeyQ')) g.yaw += CAMERA.rotateSpeed * dt;
    if (this.keys.has('KeyE')) g.yaw -= CAMERA.rotateSpeed * dt;
  }
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
