// ============================================================
// ENVIRONMENT — room, lighting, atmosphere
// ============================================================
import * as THREE from "three";

export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a140e);
  scene.fog = new THREE.FogExp2(0x1a140e, 0.035);
  return scene;
}

export function buildLighting(scene, softShadows = true) {
  const hemi = new THREE.HemisphereLight(0xfff2df, 0x22190f, 0.65);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffe3b0, 1.15);
  key.position.set(6, 10, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(softShadows ? 2048 : 1024, softShadows ? 2048 : 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0015;
  key.shadow.radius = softShadows ? 4 : 1;
  scene.add(key);

  const fill = new THREE.PointLight(0xffcf9e, 0.5, 20);
  fill.position.set(-5, 6, -4);
  scene.add(fill);

  const rim = new THREE.PointLight(0x88bfff, 0.3, 24);
  rim.position.set(0, 8, -10);
  scene.add(rim);

  return { hemi, key, fill, rim };
}

export function buildRoom(scene) {
  const roomGroup = new THREE.Group();

  // Floor is added by Tower.buildGround(); here we add walls & pillars for ambience.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 });
  const wallGeo = new THREE.CylinderGeometry(19, 19, 14, 32, 1, true);
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.material.side = THREE.BackSide;
  wall.position.y = 6;
  wall.receiveShadow = true;
  roomGroup.add(wall);

  // Soft circular rug under the tower
  const rugGeo = new THREE.CircleGeometry(4.5, 48);
  const rugMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 });
  const rug = new THREE.Mesh(rugGeo, rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.01;
  rug.receiveShadow = true;
  roomGroup.add(rug);

  // Ambient floating dust / particles for atmosphere
  const dustGeo = new THREE.BufferGeometry();
  const dustCount = 140;
  const positions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 1] = Math.random() * 12;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xffe9c4, size: 0.03, transparent: true, opacity: 0.35 });
  const dust = new THREE.Points(dustGeo, dustMat);
  roomGroup.add(dust);

  scene.add(roomGroup);
  return { roomGroup, dust };
}

export function animateDust(dust, dt) {
  if (!dust) return;
  const positions = dust.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    let y = positions.getY(i) - dt * 0.15;
    if (y < 0) y = 12;
    positions.setY(i, y);
  }
  positions.needsUpdate = true;
}
