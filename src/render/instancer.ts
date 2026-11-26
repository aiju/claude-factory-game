// A growable InstancedMesh, refilled every frame.

import * as THREE from 'three';

export class Instancer {
  mesh: THREE.InstancedMesh;
  private n = 0;

  constructor(
    private geo: THREE.BufferGeometry,
    private mat: THREE.Material,
    private parent: THREE.Object3D,
    private cap = 64,
    private shadows = true,
  ) {
    this.mesh = this.make(cap);
  }

  private make(cap: number) {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = this.shadows;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    this.parent.add(m);
    return m;
  }

  begin() {
    this.n = 0;
  }

  add(m: THREE.Matrix4, colour?: THREE.Color) {
    if (this.n >= this.cap) {
      const old = this.mesh;
      this.cap *= 2;
      this.mesh = this.make(this.cap);
      this.mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      if (old.instanceColor) {
        this.mesh.setColorAt(0, new THREE.Color());
        this.mesh.instanceColor!.array.set(old.instanceColor.array);
      }
      this.parent.remove(old);
      old.dispose();
    }
    this.mesh.setMatrixAt(this.n, m);
    if (colour) this.mesh.setColorAt(this.n, colour);
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
