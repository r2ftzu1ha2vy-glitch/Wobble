// ============================================================
// MULTIPLAYER GAME — shared tower, turn-based, Firebase-synced
// ============================================================
import * as THREE from "three";
import { Tower, createPhysicsWorld, BLOCK_SIZE } from "./tower.js";
import { buildScene, buildLighting, buildRoom, animateDust } from "./environment.js";
import { PlayerController } from "./playerController.js";
import { TimingGame } from "./timingGame.js";
import { ScoreTracker } from "./scoring.js";
import { audio } from "./audio.js";
import { $, clamp, formatNumber } from "./utils.js";

const REMOTE_UPDATE_INTERVAL = 0.12; // seconds between position broadcasts

export class MultiplayerGame {
  constructor({ canvas, settings, network, room, onGameOver }) {
    this.canvas = canvas;
    this.settings = settings;
    this.net = network;
    this.room = room; // initial room snapshot
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
    this._seedBlockIdsFromLocalTower();

    this.player = new PlayerController(this.camera, canvas, { sensitivity: settings.sensitivity });
    this.timingGame = new TimingGame();
    this.score = new ScoreTracker();

    this.raycaster = new THREE.Raycaster();
    this.hoveredBlock = null;
    this.grabbedBlock = null;
    this.state = "idle";
    this.paused = false;
    this.gameOver = false;

    this.remotePlayers = new Map(); // playerId -> { mesh, nameSprite, lastPos }
    this._remoteUpdateTimer = 0;

    this._clock = new THREE.Clock();
    this._collapseCheckTimer = 0;
    this._settleTimer = 0;

    this._bindInput();
    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);

    this._buildRemotePlayerMeshes(room.players || {});
    this._updateHud();
    this._updateTurnBanner();

    this.net.onRoomUpdate((roomData) => this._onRoomUpdate(roomData));

    this._running = true;
    this._loop();
  }

  _seedBlockIdsFromLocalTower() {
    // Ensure our locally generated block ids match a predictable scheme so all
    // clients that build the same deterministic initial tower agree on IDs.
    // (Already deterministic since buildInitialTower assigns ids in order.)
  }

  get myId() {
    return this.net.playerId;
  }

  get isMyTurn() {
    return this._currentTurn === this.myId && !this.gameOver;
  }

  _bindInput() {
    this.canvas.addEventListener("click", () => this._handleClick());
    this.canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) this._handleClick();
    }, { passive: true });

    const actionBtn = $("mobile-action-btn");
    if (actionBtn) {
      actionBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._handleClick();
      });
    }
  }

  _handleClick() {
    if (this.paused || this.gameOver) return;
    if (!this.isMyTurn) return;

    if (this.state === "idle") {
      this._tryGrab();
    } else if (this.state === "timing") {
      this._attemptTimingClick();
    } else if (this.state === "carrying") {
      this._placeBlock();
    }
  }

  async _tryGrab() {
    if (!this.hoveredBlock) return;
    const locked = await this.net.acquireLock();
    if (!locked) return; // someone else edited simultaneously — ignore

    this.grabbedBlock = this.hoveredBlock;
    this.state = "timing";
    const difficulty = clamp(this.tower.getHeightBlocks() / 60, 0, 1);
    audio.playUiClick();
    this.timingGame.start(difficulty).then((success) => this._onTimingResult(success));
  }

  _attemptTimingClick() {
    this.timingGame.attempt();
  }

  async _onTimingResult(success) {
    if (this.state !== "timing") return;
    if (success) {
      audio.playSuccessTiming();
      const gained = this.score.registerSuccessfulGrab(0.7);
      this.tower.detachBlock(this.grabbedBlock);
      await this.net.setBlockState(this.grabbedBlock.id, { state: "grabbed" });
      this.state = "carrying";
      $("carry-hint").style.display = "block";
    } else {
      audio.playFailTiming();
      this.score.registerFailure();
      this.tower.applyDisturbance(this.grabbedBlock.mesh.position, 1.0);
      audio.playWobble();
      this.grabbedBlock = null;
      this.state = "idle";
      await this.net.releaseLock();
      await this._advanceTurn();
    }
    this._updateHud();
  }

  async _placeBlock() {
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
    this.score.registerSuccessfulPlacement(newHeight);

    await this.net.setBlockState(this.grabbedBlock.id, {
      state: "placed",
      position: { x: placePos.x, y: placePos.y, z: placePos.z },
      rotation: { y: rotY }
    });
    await this.net.updateScore(this.myId, this.score.score);
    await this.net.updateHeight(newHeight);
    await this.net.releaseLock();

    this.grabbedBlock = null;
    this.state = "settling";
    this._settleTimer = 1.1;
    $("carry-hint").style.display = "none";
    this._updateHud();

    await this._advanceTurn();
  }

  async _advanceTurn() {
    const players = Object.entries(this.room.players || {})
      .filter(([, p]) => p.connected)
      .sort((a, b) => (a[1].joinOrder ?? 0) - (b[1].joinOrder ?? 0));
    if (players.length === 0) return;
    const currentIdx = players.findIndex(([id]) => id === this._currentTurn);
    const nextIdx = (currentIdx + 1) % players.length;
    const nextPlayerId = players[nextIdx][0];
    await this.net.advanceTurn(nextPlayerId, (this.room.turnNumber || 0) + 1);
  }

  _onRoomUpdate(roomData) {
    if (!roomData) return;
    this.room = roomData;
    this._currentTurn = roomData.currentTurn;

    this._updateTurnBanner();
    this._syncRemotePlayers(roomData.players || {});
    this._syncTowerFromRemote(roomData.tower?.blocks || {});
    this._updateScoresFromRemote(roomData.players || {});

    if (roomData.status === "collapsed" && !this.gameOver) {
      this.gameOver = true;
      this._handleRemoteCollapse(roomData);
    }
  }

  _updateScoresFromRemote(players) {
    const me = players[this.myId];
    if (me && typeof me.score === "number") {
      this.score.score = me.score;
    }
    this._updateHud();
  }

  _updateTurnBanner() {
    const banner = $("turn-banner");
    if (!banner) return;
    banner.style.display = "block";
    const currentPlayer = this.room.players?.[this._currentTurn];
    const name = currentPlayer?.username || "Player";
    banner.textContent = this.isMyTurn ? "YOUR TURN" : `${name.toUpperCase()}'S TURN`;
    banner.style.color = this.isMyTurn ? "var(--accent)" : "var(--accent-2)";
  }

  _buildRemotePlayerMeshes(players) {
    for (const [pid, pdata] of Object.entries(players)) {
      if (pid === this.myId) continue;
      this._addRemotePlayerMesh(pid, pdata);
    }
  }

  _addRemotePlayerMesh(pid, pdata) {
    const group = new THREE.Group();
    const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: this._colorForPlayer(pdata.joinOrder) });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);

    // Name label via sprite (canvas texture)
    const sprite = this._makeNameSprite(pdata.username || "Player");
    sprite.position.y = 1.75;
    group.add(sprite);

    this.scene.add(group);
    this.remotePlayers.set(pid, { group, sprite, username: pdata.username });
    this._updateRemotePlayerTransform(pid, pdata);
  }

  _colorForPlayer(joinOrder) {
    const colors = [0x6fe0a0, 0xffb454, 0x7ea8ff, 0xff8a8a];
    return colors[(joinOrder ?? 0) % colors.length];
  }

  _makeNameSprite(text) {
    const canvasEl = document.createElement("canvas");
    canvasEl.width = 256; canvasEl.height = 64;
    const ctx = canvasEl.getContext("2d");
    ctx.font = "bold 32px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(20,16,12,0.65)";
    ctx.roundRect?.(8, 8, 240, 48, 12);
    ctx.fill();
    ctx.fillStyle = "#f4ece2";
    ctx.fillText(text.slice(0, 14), 128, 40);
    const texture = new THREE.CanvasTexture(canvasEl);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.6, 0.4, 1);
    return sprite;
  }

  _syncRemotePlayers(players) {
    for (const [pid, pdata] of Object.entries(players)) {
      if (pid === this.myId) continue;
      if (!pdata.connected) {
        this._removeRemotePlayer(pid);
        continue;
      }
      if (!this.remotePlayers.has(pid)) {
        this._addRemotePlayerMesh(pid, pdata);
      } else {
        this._updateRemotePlayerTransform(pid, pdata);
      }
    }
    // Remove players no longer in the room at all
    for (const pid of this.remotePlayers.keys()) {
      if (!players[pid]) this._removeRemotePlayer(pid);
    }
  }

  _updateRemotePlayerTransform(pid, pdata) {
    const rp = this.remotePlayers.get(pid);
    if (!rp || !pdata.position) return;
    rp.group.position.set(pdata.position.x, 0, pdata.position.z);
    if (pdata.rotation) rp.group.rotation.y = pdata.rotation.yaw || 0;
  }

  _removeRemotePlayer(pid) {
    const rp = this.remotePlayers.get(pid);
    if (!rp) return;
    this.scene.remove(rp.group);
    this.remotePlayers.delete(pid);
  }

  _syncTowerFromRemote(blocksData) {
    for (const [blockId, data] of Object.entries(blocksData)) {
      const block = this.tower.getBlockById(blockId);
      if (!block) continue;
      if (data.state === "placed" && !block.placedOnTop && !block.grabbed) {
        // Another player placed this block — apply it locally if we haven't already.
        const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        this.tower.placeBlockOnTop(block, pos, data.rotation?.y || 0);
      }
    }
  }

  _handleRemoteCollapse(roomData) {
    this.tower.triggerCollapse();
    audio.playCollapse();
    setTimeout(() => {
      const players = roomData.players || {};
      const scoreboard = Object.entries(players).map(([id, p]) => ({
        id, username: p.username, score: p.score || 0
      }));
      this.onGameOver?.({
        finalHeight: roomData.game?.height || 0,
        winnerId: roomData.game?.winner,
        scoreboard
      });
    }, 1400);
  }

  async _checkAndDeclareCollapseIfMyTurn() {
    // Any client can detect & report collapse; use lock-free simple write since
    // it's idempotent (status transition only matters once).
    if (this.room.status === "collapsed") return;
    const players = Object.entries(this.room.players || {});
    let winner = null;
    let bestScore = -1;
    for (const [id, p] of players) {
      if ((p.score || 0) > bestScore) { bestScore = p.score || 0; winner = id; }
    }
    await this.net.declareCollapse(winner);
  }

  _updateHovered() {
    if (this.state !== "idle" || !this.isMyTurn) {
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
    $("hud-height").textContent = String(this.tower.getHeightBlocks());
    $("hud-combo").textContent = `x${this.score.combo}`;
    $("hud-best").textContent = String(this.score.best);
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
    this.world.step(1 / 60, dt, 3);
    this.tower.syncMeshes();
    animateDust(this.dust, dt);
    this._updateHovered();

    if (this.state === "settling") {
      this._settleTimer -= dt;
      if (this._settleTimer <= 0) this.state = "idle";
    }

    this._remoteUpdateTimer += dt;
    if (this._remoteUpdateTimer > REMOTE_UPDATE_INTERVAL) {
      this._remoteUpdateTimer = 0;
      this.net.updatePlayerTransform(this.player.position, this.player.yaw);
    }

    this._collapseCheckTimer += dt;
    if (this._collapseCheckTimer > 0.3) {
      this._collapseCheckTimer = 0;
      if (!this.gameOver && this.tower.checkCollapse()) {
        this._checkAndDeclareCollapseIfMyTurn();
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this._running = false;
    window.removeEventListener("resize", this._onResize);
    this.net.offAll();
    this.tower.reset();
    for (const pid of [...this.remotePlayers.keys()]) this._removeRemotePlayer(pid);
    this.renderer.dispose();
  }
}
