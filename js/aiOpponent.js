// ============================================================
// AI OPPONENT — a simple bot "second player" for Solo mode.
// Runs on its own timer, independent of the human player's
// timing-minigame UI. Grabs a random block from the shared
// tower, rolls a success/fail check based on difficulty, and
// places it back on top — same physical operations a human
// player performs, just driven by a timer instead of clicks.
// ============================================================
import * as THREE from "three";
import { BLOCK_SIZE } from "./tower.js";
import { clamp, randRange } from "./utils.js";
import { audio } from "./audio.js";

export class AiOpponent {
  /**
   * @param {object} opts
   * @param {import("./tower.js").Tower} opts.tower
   * @param {{score:number}} opts.onScoreChange - callback(newScore) fired whenever the AI's score changes
   * @param {(active:boolean)=>void} [opts.onStateChange] - fired true when AI is "acting" (for UI feedback), false when idle/waiting
   */
  constructor({ tower, onScoreChange, onStateChange }) {
    this.tower = tower;
    this.onScoreChange = onScoreChange;
    this.onStateChange = onStateChange;

    this.score = 0;
    this.enabled = true;
    this.state = "waiting"; // waiting | grabbing | placing
    this.grabbedBlock = null;

    // Timing: the AI "thinks" for a random interval, then acts.
    this._thinkTimer = randRange(2.5, 4.5);
    this._actionTimer = 0;
  }

  setEnabled(v) {
    this.enabled = v;
  }

  /** Call every frame with dt (seconds). */
  update(dt) {
    if (!this.enabled) return;

    if (this.state === "waiting") {
      this._thinkTimer -= dt;
      if (this._thinkTimer <= 0) this._startGrab();
      return;
    }

    // "grabbing" and "placing" states have a short animation-ish delay
    // to feel like an action is happening rather than an instant snap.
    this._actionTimer -= dt;
    if (this._actionTimer > 0) return;

    if (this.state === "grabbing") {
      this._resolveGrab();
    } else if (this.state === "placing") {
      this._resolvePlace();
    }
  }

  _pickBlock() {
    const candidates = this.tower.blocks.filter(b => !b.removed && !b.grabbed);
    if (candidates.length === 0) return null;
    // Prefer blocks from the upper half of the tower, like a real player would
    candidates.sort((a, b) => b.layer - a.layer);
    const pool = candidates.slice(0, Math.max(3, Math.floor(candidates.length / 2)));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _startGrab() {
    const block = this._pickBlock();
    if (!block) {
      this._thinkTimer = randRange(2, 3);
      return;
    }
    this.grabbedBlock = block;
    this.state = "grabbing";
    this._actionTimer = randRange(0.6, 1.1);
    this.onStateChange?.(true);
  }

  _resolveGrab() {
    // Difficulty scales with tower height, mirroring the human timing game.
    const difficulty = clamp(this.tower.getHeightBlocks() / 60, 0, 1);
    const successChance = 0.78 - difficulty * 0.35; // gets harder as tower grows
    const success = Math.random() < successChance;

    if (success) {
      audio.playSuccessTiming();
      this.tower.detachBlock(this.grabbedBlock);
      this.state = "placing";
      this._actionTimer = randRange(0.5, 0.9);
    } else {
      audio.playFailTiming();
      this.tower.applyDisturbance(this.grabbedBlock.mesh.position, 0.8);
      audio.playWobble();
      this.grabbedBlock = null;
      this.state = "waiting";
      this._thinkTimer = randRange(2.5, 4);
      this.onStateChange?.(false);
    }
  }

  _resolvePlace() {
    if (!this.grabbedBlock) {
      this.state = "waiting";
      this._thinkTimer = randRange(2, 3);
      this.onStateChange?.(false);
      return;
    }
    const topY = this.tower.getTopY();
    const angle = Math.random() * Math.PI * 2;
    const radius = randRange(0.3, 1.2);
    const placePos = new THREE.Vector3(
      Math.cos(angle) * radius,
      topY + BLOCK_SIZE.y / 2 + 0.05,
      Math.sin(angle) * radius
    );
    const rotY = Math.round(Math.random()) * (Math.PI / 2);
    this.tower.placeBlockOnTop(this.grabbedBlock, placePos, rotY);
    audio.playPlace();

    this.score += 60;
    this.onScoreChange?.(this.score);

    this.grabbedBlock = null;
    this.state = "waiting";
    this._thinkTimer = randRange(2.5, 4.5);
    this.onStateChange?.(false);
  }

  reset() {
    this.score = 0;
    this.grabbedBlock = null;
    this.state = "waiting";
    this._thinkTimer = randRange(2.5, 4.5);
  }
}
