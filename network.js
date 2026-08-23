// ============================================================
// NETWORK — Firebase Realtime Database multiplayer layer
// ============================================================
// Firebase RTDB structure:
//
// rooms/
//   ROOM_CODE/
//     status            "lobby" | "playing" | "collapsed"
//     host              playerId
//     currentTurn       playerId
//     turnNumber        int
//     createdAt         timestamp
//     players/
//       playerID/
//         username
//         position {x,y,z}
//         rotation {yaw}
//         connected
//         score
//         joinOrder
//     tower/
//       blocks/
//         blockID/
//           position {x,y,z}
//           rotation {y}
//           layer
//           state        "standing" | "grabbed" | "placed" | "removed"
//     game/
//       height
//       winner
//       rematchVotes/
//         playerID: true
//     lock/
//       heldBy           playerId or null   (mutual-exclusion for tower edits)
// ============================================================

import { getDb, initFirebase } from "./firebaseConfig.js";
import { generateRoomCode } from "./utils.js";

export class NetworkManager {
  constructor() {
    const { ok } = initFirebase();
    this.ready = ok;
    this.db = getDb();
    this.roomCode = null;
    this.playerId = null;
    this.isHost = false;
    this._listeners = [];
  }

  get available() {
    return this.ready && !!this.db;
  }

  _ref(path) {
    return this.db.ref(path);
  }

  async createRoom(playerId, username) {
    if (!this.available) throw new Error("Multiplayer is not configured (Firebase not set up).");
    let code;
    let exists = true;
    let attempts = 0;
    do {
      code = generateRoomCode(4);
      const snap = await this._ref(`rooms/${code}`).get();
      exists = snap.exists();
      attempts++;
    } while (exists && attempts < 10);

    const roomData = {
      status: "lobby",
      host: playerId,
      currentTurn: playerId,
      turnNumber: 0,
      createdAt: Date.now(),
      players: {
        [playerId]: {
          username,
          position: { x: 0, y: 1.7, z: 6 },
          rotation: { yaw: 0 },
          connected: true,
          score: 0,
          joinOrder: 0
        }
      },
      tower: { blocks: {} },
      game: { height: 0, winner: null, status: "lobby" },
      lock: { heldBy: null }
    };

    await this._ref(`rooms/${code}`).set(roomData);
    this.roomCode = code;
    this.playerId = playerId;
    this.isHost = true;

    this._setupPresence(code, playerId);
    return code;
  }

  async joinRoom(code, playerId, username) {
    if (!this.available) throw new Error("Multiplayer is not configured (Firebase not set up).");
    code = code.toUpperCase();
    const roomSnap = await this._ref(`rooms/${code}`).get();
    if (!roomSnap.exists()) {
      throw new Error("NOT_FOUND");
    }
    const room = roomSnap.val();
    const players = room.players || {};
    const count = Object.keys(players).length;
    if (count >= 4) {
      throw new Error("FULL");
    }
    if (room.status !== "lobby") {
      throw new Error("IN_PROGRESS");
    }

    await this._ref(`rooms/${code}/players/${playerId}`).set({
      username,
      position: { x: 0, y: 1.7, z: 6 },
      rotation: { yaw: 0 },
      connected: true,
      score: 0,
      joinOrder: count
    });

    this.roomCode = code;
    this.playerId = playerId;
    this.isHost = room.host === playerId;

    this._setupPresence(code, playerId);
    return room;
  }

  _setupPresence(code, playerId) {
    const playerRef = this._ref(`rooms/${code}/players/${playerId}`);
    playerRef.onDisconnect().update({ connected: false });
    // Also try to clean up the room lock if this player is holding it
    this._ref(`rooms/${code}/lock`).onDisconnect().set({ heldBy: null });
  }

  onRoomUpdate(callback) {
    if (!this.available || !this.roomCode) return;
    const ref = this._ref(`rooms/${this.roomCode}`);
    const handler = (snap) => callback(snap.val());
    ref.on("value", handler);
    this._listeners.push({ ref, handler });
  }

  offAll() {
    for (const { ref, handler } of this._listeners) {
      ref.off("value", handler);
    }
    this._listeners = [];
  }

  async startGame() {
    if (!this.roomCode) return;
    await this._ref(`rooms/${this.roomCode}`).update({
      status: "playing",
      "game/status": "playing"
    });
  }

  async updatePlayerTransform(position, yaw) {
    if (!this.roomCode || !this.playerId) return;
    await this._ref(`rooms/${this.roomCode}/players/${this.playerId}`).update({
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { yaw }
    });
  }

  /** Attempt to acquire the tower edit lock (mutual exclusion). Returns true if acquired. */
  async acquireLock() {
    if (!this.roomCode || !this.playerId) return false;
    const lockRef = this._ref(`rooms/${this.roomCode}/lock/heldBy`);
    const result = await lockRef.transaction((current) => {
      if (current === null || current === this.playerId) {
        return this.playerId;
      }
      return; // abort — someone else holds it
    });
    return result.committed && result.snapshot.val() === this.playerId;
  }

  async releaseLock() {
    if (!this.roomCode || !this.playerId) return;
    const lockRef = this._ref(`rooms/${this.roomCode}/lock/heldBy`);
    await lockRef.transaction((current) => (current === this.playerId ? null : current));
  }

  async setBlockState(blockId, data) {
    if (!this.roomCode) return;
    await this._ref(`rooms/${this.roomCode}/tower/blocks/${blockId}`).update(data);
  }

  async setAllBlocks(blocksObj) {
    if (!this.roomCode) return;
    await this._ref(`rooms/${this.roomCode}/tower/blocks`).set(blocksObj);
  }

  async advanceTurn(nextPlayerId, turnNumber) {
    if (!this.roomCode) return;
    await this._ref(`rooms/${this.roomCode}`).update({
      currentTurn: nextPlayerId,
      turnNumber
    });
  }

  async updateScore(playerId, score) {
    if (!this.roomCode) return;
    await this._ref(`rooms/${this.roomCode}/players/${playerId}/score`).set(score);
  }

  async updateHeight(height) {
    if (!this.roomCode) return;
    await this._ref(`rooms/${this.roomCode}/game/height`).set(height);
  }

  async declareCollapse(winnerId) {
    if (!this.roomCode) return;
    await this._ref(`rooms/${this.roomCode}`).update({
      status: "collapsed",
      "game/status": "collapsed",
      "game/winner": winnerId
    });
  }

  async voteRematch() {
    if (!this.roomCode || !this.playerId) return;
    await this._ref(`rooms/${this.roomCode}/game/rematchVotes/${this.playerId}`).set(true);
  }

  async resetForRematch(initialBlocks) {
    if (!this.roomCode) return;
    await this._ref(`rooms/${this.roomCode}`).update({
      status: "lobby",
      "game/status": "lobby",
      "game/winner": null,
      "game/height": 0,
      "game/rematchVotes": null,
      turnNumber: 0,
      "tower/blocks": initialBlocks || {},
      "lock/heldBy": null
    });
    // reset scores
    const snap = await this._ref(`rooms/${this.roomCode}/players`).get();
    const players = snap.val() || {};
    const updates = {};
    for (const pid of Object.keys(players)) {
      updates[`players/${pid}/score`] = 0;
    }
    await this._ref(`rooms/${this.roomCode}`).update(updates);
  }

  async leaveRoom() {
    if (!this.roomCode || !this.playerId) return;
    await this._ref(`rooms/${this.roomCode}/players/${this.playerId}`).remove();
    this.offAll();
    this.roomCode = null;
    this.isHost = false;
  }
}
