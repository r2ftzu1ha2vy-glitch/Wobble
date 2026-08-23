// ============================================================
// PLAYER CONTROLLER — first-person movement & look
// ============================================================
import * as THREE from "three";
import { clamp, isMobileDevice, $ } from "./utils.js";

const MOVE_SPEED = 4.2;
const EYE_HEIGHT = 1.7;
const BOUNDS_RADIUS = 9; // keep player within the room

export class PlayerController {
  constructor(camera, domElement, options = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.sensitivity = (options.sensitivity ?? 100) / 100;

    this.yaw = 0;
    this.pitch = 0;

    this.position = new THREE.Vector3(0, EYE_HEIGHT, 6);
    this.camera.position.copy(this.position);

    this.keys = { forward: false, backward: false, left: false, right: false };
    this.enabled = true;
    this.locked = false;

    this.isMobile = isMobileDevice();
    this._joystickVec = { x: 0, y: 0 };

    this._bindDesktop();
    if (this.isMobile) this._bindMobile();
  }

  setSensitivity(v) {
    this.sensitivity = v / 100;
  }

  _bindDesktop() {
    this.domElement.addEventListener("click", () => {
      if (!this.isMobile && this.enabled && !this.locked) {
        this.domElement.requestPointerLock?.();
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.domElement;
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked || !this.enabled) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      this.yaw -= dx * 0.0022 * this.sensitivity;
      this.pitch -= dy * 0.0022 * this.sensitivity;
      this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    });

    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      switch (e.code) {
        case "KeyW": case "ArrowUp": this.keys.forward = true; break;
        case "KeyS": case "ArrowDown": this.keys.backward = true; break;
        case "KeyA": case "ArrowLeft": this.keys.left = true; break;
        case "KeyD": case "ArrowRight": this.keys.right = true; break;
      }
    });
    window.addEventListener("keyup", (e) => {
      switch (e.code) {
        case "KeyW": case "ArrowUp": this.keys.forward = false; break;
        case "KeyS": case "ArrowDown": this.keys.backward = false; break;
        case "KeyA": case "ArrowLeft": this.keys.left = false; break;
        case "KeyD": case "ArrowRight": this.keys.right = false; break;
      }
    });
  }

  _bindMobile() {
    const zone = $("joystick-zone");
    const thumb = $("joystick-thumb");
    if (!zone || !thumb) return;

    let dragging = false;
    let originX = 0, originY = 0;
    const maxDist = 40;

    const start = (x, y) => {
      dragging = true;
      const rect = zone.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
    };
    const move = (x, y) => {
      if (!dragging) return;
      let dx = x - originX;
      let dy = y - originY;
      const dist = Math.min(maxDist, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * dist;
      dy = Math.sin(angle) * dist;
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;
      this._joystickVec = { x: dx / maxDist, y: dy / maxDist };
    };
    const end = () => {
      dragging = false;
      thumb.style.transform = "translate(0,0)";
      this._joystickVec = { x: 0, y: 0 };
    };

    zone.addEventListener("touchstart", (e) => { start(); move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    zone.addEventListener("touchmove", (e) => { move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    zone.addEventListener("touchend", end);

    // Look via drag on the rest of the screen
    let lookTouchId = null;
    let lastX = 0, lastY = 0;
    this.domElement.addEventListener("touchstart", (e) => {
      for (const t of e.changedTouches) {
        const rect = zone.getBoundingClientRect();
        const inJoystick = t.clientX < rect.right + 40 && t.clientY > rect.top - 40;
        if (!inJoystick && lookTouchId === null) {
          lookTouchId = t.identifier;
          lastX = t.clientX; lastY = t.clientY;
        }
      }
    }, { passive: true });
    this.domElement.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookTouchId) {
          const dx = t.clientX - lastX;
          const dy = t.clientY - lastY;
          lastX = t.clientX; lastY = t.clientY;
          this.yaw -= dx * 0.004 * this.sensitivity;
          this.pitch -= dy * 0.004 * this.sensitivity;
          this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
        }
      }
    }, { passive: true });
    this.domElement.addEventListener("touchend", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookTouchId) lookTouchId = null;
      }
    });
  }

  update(dt) {
    if (!this.enabled) return;

    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);

    let moveX = 0, moveZ = 0;
    if (this.keys.forward) moveZ += 1;
    if (this.keys.backward) moveZ -= 1;
    if (this.keys.right) moveX += 1;
    if (this.keys.left) moveX -= 1;

    if (this.isMobile) {
      moveZ += -this._joystickVec.y;
      moveX += this._joystickVec.x;
    }

    const moveVec = new THREE.Vector3();
    moveVec.addScaledVector(forward, moveZ);
    moveVec.addScaledVector(right, moveX);
    if (moveVec.lengthSq() > 0) moveVec.normalize();

    this.position.addScaledVector(moveVec, MOVE_SPEED * dt);

    // Keep inside room bounds (circular)
    const distFromCenter = Math.hypot(this.position.x, this.position.z);
    if (distFromCenter > BOUNDS_RADIUS) {
      const scale = BOUNDS_RADIUS / distFromCenter;
      this.position.x *= scale;
      this.position.z *= scale;
    }

    this.camera.position.set(this.position.x, EYE_HEIGHT, this.position.z);
  }

  getForwardDirection() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dir;
  }
}
