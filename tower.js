// ============================================================
// TOWER — physics + 3D block management (Jenga-style)
// ============================================================
import * as THREE from "three";
import * as CANNON from "cannon-es";

export const BLOCK_SIZE = { x: 0.75, y: 0.5, z: 2.25 }; // width, height, length
const BLOCKS_PER_LAYER = 3;
const BLOCK_MASS = 1.1;
const START_LAYERS = 14;

// Wood color variety for visual richness
const WOOD_COLORS = [0xc98a4b, 0xba7a3d, 0xd49a5a, 0xa5652e, 0xcf9257];

export class Tower {
  /**
   * @param {THREE.Scene} scene
   * @param {CANNON.World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.blocks = []; // { id, mesh, body, layer, indexInLayer, removed, settled }
    this.blockIdCounter = 0;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.blockMaterial = new CANNON.Material("block");
    const contact = new CANNON.ContactMaterial(this.blockMaterial, this.blockMaterial, {
      friction: 0.6,
      restitution: 0.05
    });
    this.world.addContactMaterial(contact);

    this.groundBody = null;
  }

  buildGround() {
    const groundShape = new CANNON.Box(new CANNON.Vec3(20, 0.5, 20));
    const groundBody = new CANNON.Body({ mass: 0, material: this.blockMaterial });
    groundBody.addShape(groundShape);
    groundBody.position.set(0, -0.5, 0);
    this.world.addBody(groundBody);
    this.groundBody = groundBody;

    const groundGeo = new THREE.PlaneGeometry(40, 40);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.95 });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = 0;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);
  }

  /** Build the initial standard Jenga tower (alternating layer orientation). */
  buildInitialTower(layers = START_LAYERS) {
    for (let layer = 0; layer < layers; layer++) {
      const rotated = layer % 2 === 1;
      for (let i = 0; i < BLOCKS_PER_LAYER; i++) {
        const offset = (i - 1) * (BLOCK_SIZE.x + 0.02);
        let x = 0, z = 0;
        if (rotated) z = offset; else x = offset;
        const y = BLOCK_SIZE.y / 2 + layer * BLOCK_SIZE.y;
        const rotY = rotated ? Math.PI / 2 : 0;
        this.addBlock({ x, y, z, rotY, layer, indexInLayer: i, awake: false });
      }
    }
  }

  addBlock({ x, y, z, rotY = 0, layer, indexInLayer = 0, awake = true, id = null, colorSeed = null }) {
    const id_ = id ?? `b${this.blockIdCounter++}`;
    const color = WOOD_COLORS[
      colorSeed !== null ? colorSeed % WOOD_COLORS.length : Math.floor(Math.random() * WOOD_COLORS.length)
    ];

    // Three.js mesh
    const geo = new THREE.BoxGeometry(BLOCK_SIZE.x, BLOCK_SIZE.y, BLOCK_SIZE.z);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      metalness: 0.05
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    this.group.add(mesh);

    // Cannon body
    const shape = new CANNON.Box(new CANNON.Vec3(BLOCK_SIZE.x / 2, BLOCK_SIZE.y / 2, BLOCK_SIZE.z / 2));
    const body = new CANNON.Body({
      mass: BLOCK_MASS,
      material: this.blockMaterial,
      linearDamping: 0.35,
      angularDamping: 0.5
    });
    body.addShape(shape);
    body.position.set(x, y, z);
    body.quaternion.setFromEuler(0, rotY, 0);
    if (!awake) body.sleep();
    this.world.addBody(body);

    const record = {
      id: id_,
      mesh,
      body,
      layer,
      indexInLayer,
      removed: false,
      grabbed: false,
      color
    };
    this.blocks.push(record);
    return record;
  }

  getBlockById(id) {
    return this.blocks.find(b => b.id === id);
  }

  /** Sync three.js meshes to cannon bodies. Call every frame. */
  syncMeshes() {
    for (const b of this.blocks) {
      if (b.removed || b.grabbed) continue;
      b.mesh.position.copy(b.body.position);
      b.mesh.quaternion.copy(b.body.quaternion);
    }
  }

  /** Remove a block from the physics world (used when grabbed by a player). */
  detachBlock(block) {
    this.world.removeBody(block.body);
    block.grabbed = true;
  }

  /** Re-insert the block into the physics world at a new top position. */
  placeBlockOnTop(block, position, rotationY) {
    block.mesh.position.copy(position);
    block.mesh.rotation.set(0, rotationY, 0);

    const newBody = new CANNON.Body({
      mass: BLOCK_MASS,
      material: this.blockMaterial,
      linearDamping: 0.35,
      angularDamping: 0.5
    });
    newBody.addShape(new CANNON.Box(new CANNON.Vec3(BLOCK_SIZE.x / 2, BLOCK_SIZE.y / 2, BLOCK_SIZE.z / 2)));
    newBody.position.copy(position);
    newBody.quaternion.setFromEuler(0, rotationY, 0);
    this.world.addBody(newBody);

    block.body = newBody;
    block.grabbed = false;
    block.placedOnTop = true;
  }

  /** Returns the current highest occupied Y among non-removed blocks. */
  getTopY() {
    let maxY = 0;
    for (const b of this.blocks) {
      if (b.removed) continue;
      const y = b.grabbed ? b.mesh.position.y : b.body.position.y;
      if (y > maxY) maxY = y;
    }
    return maxY;
  }

  /** Approximate current tower height in "layers" (visual, not literal layer count). */
  getHeightBlocks() {
    return this.blocks.filter(b => !b.removed).length;
  }

  /** Detect if the tower has collapsed: any block fell below threshold or tipped drastically. */
  checkCollapse() {
    for (const b of this.blocks) {
      if (b.removed || b.grabbed) continue;
      if (b.body.position.y < -3) return true;
      // Large tilt on a mid/high block suggests structural failure
      const euler = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w)
      );
      const tiltX = Math.abs(euler.x);
      const tiltZ = Math.abs(euler.z);
      if ((tiltX > 1.0 || tiltZ > 1.0) && b.layer > 2) return true;
    }
    return false;
  }

  /** Nudge the tower slightly — used on failed timing attempts. */
  applyDisturbance(originPosition, strength = 1.2) {
    for (const b of this.blocks) {
      if (b.removed || b.grabbed) continue;
      const dist = b.body.position.distanceTo(
        new CANNON.Vec3(originPosition.x, originPosition.y, originPosition.z)
      );
      if (dist < 3) {
        const falloff = Math.max(0, 1 - dist / 3);
        b.body.wakeUp();
        b.body.velocity.x += (Math.random() - 0.5) * strength * falloff;
        b.body.velocity.z += (Math.random() - 0.5) * strength * falloff;
        b.body.angularVelocity.y += (Math.random() - 0.5) * strength * falloff * 0.5;
      }
    }
  }

  /** Trigger dramatic collapse — wake all bodies & apply outward impulses. */
  triggerCollapse() {
    for (const b of this.blocks) {
      if (b.removed || b.grabbed) continue;
      b.body.wakeUp();
      const dir = new CANNON.Vec3(
        (Math.random() - 0.5) * 3,
        Math.random() * 1.5,
        (Math.random() - 0.5) * 3
      );
      b.body.velocity.set(dir.x, dir.y + 1, dir.z);
      b.body.angularVelocity.set(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6
      );
    }
  }

  reset() {
    for (const b of this.blocks) {
      if (!b.removed) this.world.removeBody(b.body);
      this.group.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    this.blocks = [];
    this.blockIdCounter = 0;
  }
}

export function createPhysicsWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 12;
  return world;
}
