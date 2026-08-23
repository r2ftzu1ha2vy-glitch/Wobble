// ============================================================
// SOLO GAME — single player Wobble session
// ============================================================
import * as THREE from "three";
import { Tower, createPhysicsWorld, BLOCK_SIZE } from "./tower.js";
import { buildScene, buildLighting, buildRoom, animateDust } from "./environment.js";
import { PlayerController } from "./playerController.js";
import { TimingGame } from "./timingGame.js";
import { ScoreTracker } from "./scoring.js";
import { AiOpponent } from "./aiOpponent.js";
import { audio } from "./audio.js";
import { $, clamp, formatNumber } from "./utils.js";

export class SoloGame {
  constructor({ canvas, settings, onGameOver }) {
    this.canvas = canvas;
    this.settings = settings;
    this.onGameOver = onGameOver;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = buildScene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);

    buildLighting(this.scene, settings.shadows);
    const { dust } = buildRoom(this.scene);
    this.dust = dust;

    this.world = createPhysicsWorld();
    this.tower = new Tower(this.scene, this.world);
    this.tower.buildGround();
    this.tower.buildInitialTower();

    this.player = new PlayerController(this.camera, canvas, { sensitivity: settings.sensitivity });
    this.timingGame = new TimingGame();
    this.score = new ScoreTracker();

    this.ai = new AiOpponent({
      tower: this.tower,
      onScoreChange: (score) => this._updateAiHud(score),
      onStateChange: (active) => this._setAiIndicator(active)
    });
    this._ensureAiHud();

    this.raycaster = new THREE.Raycaster();
    this.hoveredBlock = null;
    this.grabbedBlock = null;
    this.state = "idle"; // idle | timing | carrying | settling | collapsed
    this.paused = false;

    this._clock = new THREE.Clock();
    this._collapseCheckTimer = 0;
    this._settleTimer = 0;

    this._bindInput();
    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);

    this._updateHud();
    this._running = true;
    this._loop();
  }

  _bindInput() {
    this.canvas.addEventListener("click", (e) => this._handleClick(e));
    this.canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) this._handleClick(e.touches[0]);
    }, { passive: true });

    const actionBtn = $("mobile-action-btn");
    if (actionBtn) {
      actionBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._handleAction();
      });
    }
  }

  _handleClick() {
    if (this.paused) return;
    this._handleAction();
  }

  _handleAction() {
    if (this.state === "idle") {
      this._tryGrab();
    } else if (this.state === "timing") {
      this.timingGame.attempt();
    } else if (this.state === "carrying") {
      this._placeBlock();
    }
  }

  _tryGrab() {
    if (!this.hoveredBlock) return;
    this.grabbedBlock = this.hoveredBlock;
    this.state = "timing";
    const difficulty = clamp(this.tower.getHeightBlocks() / 60, 0, 1);
    audio.playUiClick();
    this.timingGame.start(difficulty).then((success) => this._onTimingResult(success));
  }

  _onTimingResult(success) {
    if (this.state !== "timing") return;
    if (success) {
      audio.playSuccessTiming();
      const gained = this.score.registerSuccessfulGrab(0.7);
      this._toastGain(gained);
      this.tower.detachBlock(this.grabbedBlock);
      this.state = "carrying";
      $("carry-hint").style.display = "block";
    } else {
      audio.playFailTiming();
      this.score.registerFailure();
      this.tower.applyDisturbance(this.grabbedBlock.mesh.position, 1.0);
      audio.playWobble();
      this.grabbedBlock = null;
      this.state = "idle";
    }
    this._updateHud();
  }

  _placeBlock() {
    if (!this.grabbedBlock) return;
    const topY = this.tower.getTopY();
    const dir = this.player.getForwardDirection();
    const placePos = new THREE.Vector3(
      this.camera.position.x + dir.x * 2.5,
      topY + BLOCK_SIZE.y / 2 + 0.05,
      this.camera.position.z + dir.z * 2.5
    );
    const rotY = Math.round(Math.random()) * (Math.PI / 2);
    this.tower.placeBlockOnTop(this.grabbedBlock, placePos, rotY);
    audio.playPlace();

    const newHeight = this.tower.getHeightBlocks();
    const gained = this.score.registerSuccessfulPlacement(newHeight);
    this._toastGain(gained);

    this.grabbedBlock = null;
    this.state = "settling";
    this._settleTimer = 1.1;
    $("carry-hint").style.display = "none";
    this._updateHud();
  }

  _toastGain() { /* subtle — HUD update conveys score change; kept minimal to avoid spam */ }

  _updateHovered() {
    if (this.state !== "idle") {
      if (this.hoveredBlock) this._setHighlight(this.hoveredBlock, false);
      this.hoveredBlock = null;
      $("crosshair").classList.remove("highlight");
      return;
    }
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const meshes = this.tower.blocks.filter(b => !b.removed && !b.grabbed).map(b => b.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);

    if (this.hoveredBlock) this._setHighlight(this.hoveredBlock, false);

    if (hits.length > 0 && hits[0].distance < 5) {
      const block = this.tower.blocks.find(b => b.mesh === hits[0].object);
      this.hoveredBlock = block;
      this._setHighlight(block, true);
      $("crosshair").classList.add("highlight");
    } else {
      this.hoveredBlock = null;
      $("crosshair").classList.remove("highlight");
    }
  }

  _setHighlight(block, on) {
    if (!block) return;
    block.mesh.material.emissive = new THREE.Color(on ? 0x2fae6a : 0x000000);
    block.mesh.material.emissiveIntensity = on ? 0.55 : 0;
  }

  _updateHud() {
    $("hud-score").textContent = formatNumber(this.score.score);
    $("hud-height").textContent = String(this.score.height);
    $("hud-combo").textContent = `x${this.score.combo}`;
    $("hud-best").textContent = String(this.score.best);
  }

  /** Add an "AI" stat block to the HUD the first time a solo game with an AI opponent starts. */
  _ensureAiHud() {
    const hudTop = $("hud-top");
    if (!hudTop || $("hud-ai-score")) return;
    const stat = document.createElement("div");
    stat.className = "hud-stat hud-stat-ai";
    stat.id = "hud-ai-stat";
    stat.innerHTML =
      '<span class="hud-label">AI <span id="hud-ai-indicator" class="ai-indicator"></span></span>' +
      '<span id="hud-ai-score" class="hud-value">0</span>';
    hudTop.appendChild(stat);
  }

  _updateAiHud(score) {
    const el = $("hud-ai-score");
    if (el) el.textContent = formatNumber(score);
  }

  _setAiIndicator(active) {
    const el = $("hud-ai-indicator");
    if (el) el.classList.toggle("active", !!active);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setPaused(p) {
    this.paused = p;
    this.player.enabled = !p;
  }

  _loop() {
    if (!this._running) return;
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(0.05, this._clock.getDelta());
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.player.update(dt);
    this.ai.update(dt);
    this.world.step(1 / 60, dt, 3);
    this.tower.syncMeshes();
    animateDust(this.dust, dt);
    this._updateHovered();

    if (this.state === "settling") {
      this._settleTimer -= dt;
      if (this._settleTimer <= 0) this.state = "idle";
    }

    // Periodic collapse check (not every frame, cheap perf win)
    this._collapseCheckTimer += dt;
    if (this._collapseCheckTimer > 0.25) {
      this._collapseCheckTimer = 0;
      if (this.state !== "collapsed" && this.tower.checkCollapse()) {
        this._handleCollapse();
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  _handleCollapse() {
    this.state = "collapsed";
    this.ai.setEnabled(false);
    this.tower.triggerCollapse();
    audio.playCollapse();
    setTimeout(() => {
      this.onGameOver?.({
        finalHeight: this.score.height,
        score: this.score.score,
        best: this.score.best
      });
    }, 1400);
  }

  destroy() {
    this._running = false;
    this.ai.setEnabled(false);
    window.removeEventListener("resize", this._onResize);
    this.tower.reset();
    this.renderer.dispose();
    const aiStat = $("hud-ai-stat");
    if (aiStat) aiStat.remove();
  }
}
