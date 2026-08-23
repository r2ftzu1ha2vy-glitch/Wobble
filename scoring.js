// ============================================================
// SCORING SYSTEM
// ============================================================

const POINTS = {
  removeBlock: 40,
  placeBlock: 60,
  newHeightLayer: 25,
  perfectTimingBonus: 30,
  comboMultiplierStep: 0.15 // +15% per combo stack, applied to base gains
};

const BEST_HEIGHT_KEY = "wobble_best_height_v1";

export class ScoreTracker {
  constructor() {
    this.score = 0;
    this.combo = 0;
    this.height = 0;
    this.best = this._loadBest();
  }

  _loadBest() {
    try {
      return parseInt(localStorage.getItem(BEST_HEIGHT_KEY) || "0", 10) || 0;
    } catch {
      return 0;
    }
  }

  _saveBest() {
    try {
      localStorage.setItem(BEST_HEIGHT_KEY, String(this.best));
    } catch { /* ignore */ }
  }

  registerSuccessfulGrab(perfectness = 0.5) {
    this.combo += 1;
    const multiplier = 1 + (this.combo - 1) * POINTS.comboMultiplierStep;
    const gained = Math.round((POINTS.removeBlock + perfectness * POINTS.perfectTimingBonus) * multiplier);
    this.score += gained;
    return gained;
  }

  registerSuccessfulPlacement(newHeight) {
    const multiplier = 1 + (this.combo - 1) * POINTS.comboMultiplierStep;
    let gained = Math.round(POINTS.placeBlock * multiplier);
    if (newHeight > this.height) {
      gained += POINTS.newHeightLayer;
      this.height = newHeight;
      if (this.height > this.best) {
        this.best = this.height;
        this._saveBest();
      }
    }
    this.score += gained;
    return gained;
  }

  registerFailure() {
    this.combo = 0;
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.height = 0;
  }
}
