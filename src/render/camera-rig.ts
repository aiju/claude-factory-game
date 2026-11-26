// RTS camera: a target on the ground, a distance, a yaw and a pitch, with
// smoothing towards goal values set by the controls.

import * as THREE from 'three';
import { CAMERA } from '../data/camera';
import { heightAt, type Terrain } from '../sim/terrain';

export interface CamPose {
  x: number;
  z: number;
  dist: number;
  yaw: number;
  pitch: number;
}

export class CameraRig {
  goal: CamPose;
  cur: CamPose;
  targetY = 0;
  readonly target = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly terrain: Terrain,
    start: CamPose,
  ) {
    this.goal = { ...start };
    this.cur = { ...start };
    this.targetY = heightAt(terrain, start.x, start.z);
    this.apply();
  }

  clampGoal() {
    const g = this.goal;
    const s = this.terrain.size;
    g.x = Math.min(s, Math.max(0, g.x));
    g.z = Math.min(s, Math.max(0, g.z));
    g.dist = Math.min(CAMERA.maxDist, Math.max(CAMERA.minDist, g.dist));
    g.pitch = Math.min(CAMERA.maxPitch, Math.max(CAMERA.minPitch, g.pitch));
  }

  /** Jump straight to the goal (screenshots, tests). */
  snap() {
    this.clampGoal();
    this.cur = { ...this.goal };
    this.targetY = heightAt(this.terrain, this.cur.x, this.cur.z);
    this.apply();
  }

  update(dt: number) {
    this.clampGoal();
    const k = 1 - Math.exp(-CAMERA.damping * dt);
    const c = this.cur;
    const g = this.goal;
    c.x += (g.x - c.x) * k;
    c.z += (g.z - c.z) * k;
    c.dist *= Math.pow(g.dist / c.dist, k);
    let dy = g.yaw - c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * k;
    c.pitch += (g.pitch - c.pitch) * k;
    const ty = heightAt(this.terrain, c.x, c.z);
    this.targetY += (ty - this.targetY) * (1 - Math.exp(-4 * dt));
    this.apply();
  }

  private apply() {
    const c = this.cur;
    this.target.set(c.x, this.targetY, c.z);
    const cp = Math.cos(c.pitch);
    this.camera.position.set(
      c.x + c.dist * cp * Math.sin(c.yaw),
      this.targetY + c.dist * Math.sin(c.pitch),
      c.z + c.dist * cp * Math.cos(c.yaw),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
