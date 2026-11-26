// Placement ghost: translucent hull-white when valid, fault-red when not.

import * as THREE from 'three';
import type { BuildingTypeId } from '../data/buildings';
import { footprintHeights } from '../sim/build';
import type { Sim } from '../sim/world';
import { buildDockMesh } from './dock';
import { buildModel } from './models';
import { PALETTE } from './palette';

export class GhostView {
  readonly group = new THREE.Group();
  private models = new Map<BuildingTypeId, THREE.Group>();
  private current: THREE.Group | null = null;
  private dock: THREE.Mesh | null = null;
  private dockKey = '';
  private mat = new THREE.MeshStandardMaterial({
    color: PALETTE.hull,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    roughness: 0.8,
  });
  private dockMat = new THREE.MeshBasicMaterial({
    color: PALETTE.hazard,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  /** World position of the label anchor (top of the ghost). */
  readonly labelAt = new THREE.Vector3();

  constructor(private sim: Sim) {
    this.group.visible = false;
  }

  setSim(sim: Sim) {
    this.sim = sim;
  }

  private model(type: BuildingTypeId): THREE.Group {
    let g = this.models.get(type);
    if (!g) {
      const m = buildModel(type);
      g = m.root;
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = this.mat;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
      });
      this.models.set(type, g);
    }
    return g;
  }

  show(type: BuildingTypeId, x: number, z: number, rot: number, valid: boolean) {
    const g = this.model(type);
    if (this.current !== g) {
      if (this.current) this.group.remove(this.current);
      this.group.add(g);
      this.current = g;
    }
    const { hi } = footprintHeights(this.sim, type, x, z, rot);
    g.position.set(x, hi, z);
    g.rotation.y = rot;
    this.mat.color.setHex(valid ? PALETTE.hull : PALETTE.fault);
    this.dockMat.color.setHex(valid ? PALETTE.hazard : PALETTE.fault);
    const key = `${type}:${x.toFixed(2)}:${z.toFixed(2)}:${rot.toFixed(3)}`;
    if (key !== this.dockKey) {
      this.dockKey = key;
      if (this.dock) {
        this.group.remove(this.dock);
        this.dock.geometry.dispose();
      }
      this.dock = buildDockMesh(this.sim.d.terrain, type, x, z, rot, this.dockMat);
      if (this.dock) this.group.add(this.dock);
    }
    this.labelAt.set(x, hi + 5, z);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }
}
