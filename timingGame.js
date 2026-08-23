// ============================================================
// TIMING MINIGAME — moving indicator / green zone skill check
// ============================================================
import { $ } from "./utils.js";

export class TimingGame {
  constructor() {
    this.container = $("timing-ui");
    this.barEl = document.querySelector(".timing-bar");
    this.zoneEl = $("timing-zone");
    this.indicatorEl = $("timing-indicator");

    this.active = false;
    this.position = 0; // 0..1
    this.direction = 1;
    this.speed = 0.9; // fraction of bar per second
    this.zoneStart = 0.4;
    this.zoneWidth = 0.22;

    this._raf = null;
    this._lastTime = 0;
    this._resolve = null;
  }

  /**
   * Start a timing challenge.
   * @param {number} difficulty 0..1, higher = harder (faster indicator, smaller zone)
   * @returns {Promise<boolean>} resolves true on success, false on failure/miss
   */
  start(difficulty = 0) {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this.active = true;
      this.position = Math.random() < 0.5 ? 0 : 1;
      this.direction = this.position === 0 ? 1 : -1;

      // progressive difficulty scaling
      this.speed = 0.65 + difficulty * 1.35; // up to ~2.0 bar-fractions/sec
      this.zoneWidth = Math.max(0.10, 0.30 - difficulty * 0.18);
      this.zoneStart = Math.random() * (1 - this.zoneWidth);

      this.zoneEl.style.left = `${this.zoneStart * 100}%`;
      this.zoneEl.style.width = `${this.zoneWidth * 100}%`;

      this.container.style.display = "flex";
      this._lastTime = performance.now();
      this._tick();
    });
  }

  _tick() {
    if (!this.active) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._lastTime) / 1000);
    this._lastTime = now;

    this.position += this.direction * this.speed * dt;
    if (this.position >= 1) { this.position = 1; this.direction = -1; }
    if (this.position <= 0) { this.position = 0; this.direction = 1; }

    this.indicatorEl.style.left = `${this.position * 100}%`;

    this._raf = requestAnimationFrame(() => this._tick());
  }

  /** Call when the player clicks/taps to attempt the grab. */
  attempt() {
    if (!this.active) return false;
    const inZone = this.position >= this.zoneStart && this.position <= this.zoneStart + this.zoneWidth;
    this._finish(inZone);
    return inZone;
  }

  cancel() {
    this._finish(false, true);
  }

  _finish(success, silent = false) {
    this.active = false;
    cancelAnimationFrame(this._raf);
    this.container.style.display = "none";
    if (this._resolve) {
      const r = this._resolve;
      this._resolve = null;
      if (!silent) r(success);
    }
  }
}
