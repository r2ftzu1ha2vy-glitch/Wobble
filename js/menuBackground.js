// ============================================================
// MENU BACKGROUND — small ambient 3D scene behind the main menu
// ============================================================
import * as THREE from "three";

export class MenuBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
    this.camera.position.set(0, 3.4, 8);
    this.camera.lookAt(0, 2, 0);

    const hemi = new THREE.HemisphereLight(0xffe9c4, 0x1a1108, 0.8);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffcf9e, 1.1);
    key.position.set(4, 6, 3);
    this.scene.add(key);

    this.blocksGroup = new THREE.Group();
    this.scene.add(this.blocksGroup);
    this._buildTower();

    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);
    this._onResize();

    this._clock = new THREE.Clock();
    this._running = true;
    this._animate();
  }

  _buildTower() {
    const colors = [0xc98a4b, 0xba7a3d, 0xd49a5a, 0xa5652e];
    const size = { x: 0.75, y: 0.5, z: 2.25 };
    for (let layer = 0; layer < 10; layer++) {
      const rotated = layer % 2 === 1;
      for (let i = 0; i < 3; i++) {
        const offset = (i - 1) * (size.x + 0.02);
        const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
        const mat = new THREE.MeshStandardMaterial({
          color: colors[Math.floor(Math.random() * colors.length)],
          roughness: 0.8
        });
        const mesh = new THREE.Mesh(geo, mat);
        if (rotated) mesh.position.set(0, layer * size.y, offset);
        else mesh.position.set(offset, layer * size.y, 0);
        mesh.rotation.y = rotated ? Math.PI / 2 : 0;
        this.blocksGroup.add(mesh);
      }
    }
    this.blocksGroup.position.y = -1.5;
  }

  _onResize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _animate() {
    if (!this._running) return;
    requestAnimationFrame(() => this._animate());
    const t = this._clock.getElapsedTime();
    this.blocksGroup.rotation.y = t * 0.18;
    this.camera.position.y = 3.4 + Math.sin(t * 0.4) * 0.15;
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this._running = false;
    window.removeEventListener("resize", this._onResize);
    this.renderer.dispose();
  }
}
