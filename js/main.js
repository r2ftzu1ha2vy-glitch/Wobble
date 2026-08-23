// ============================================================
// MAIN — app bootstrap, screen/navigation controller
// ============================================================
import { $, loadSettings, saveSettings, generatePlayerId, randomGuestName, showToast, formatNumber, isMobileDevice } from "./utils.js";
import { audio } from "./audio.js";
import { MenuBackground } from "./menuBackground.js";
import { SoloGame } from "./soloGame.js";
import { MultiplayerGame } from "./multiplayerGame.js";
import { NetworkManager } from "./network.js";
import { initFirebase } from "./firebaseConfig.js";

// ---------------- App State ----------------
const settings = loadSettings();
if (!settings.username) settings.username = randomGuestName();

let playerId = sessionStorage.getItem("wobble_pid") || generatePlayerId();
sessionStorage.setItem("wobble_pid", playerId);

let currentGame = null;      // SoloGame | MultiplayerGame instance
let network = null;          // NetworkManager instance (multiplayer only)
let menuBg = null;
let lastRoomSnapshot = null;
let isHostFlag = false;

// ---------------- Screen Management ----------------
const screens = {};
document.querySelectorAll(".screen").forEach(el => (screens[el.id] = el));

function showScreen(id) {
  Object.values(screens).forEach(el => el.classList.remove("active"));
  screens[id].classList.add("active");
}

// ---------------- Init ----------------
function init() {
  initFirebase();
  applySettingsToUI();
  bindMainMenu();
  bindSettings();
  bindMultiplayerMenu();
  bindJoinRoom();
  bindLobby();
  bindGameControls();
  bindEndScreen();

  menuBg = new MenuBackground($("menu-bg-canvas"));
  showScreen("screen-main");

  // Unlock audio on first user gesture (required by browsers)
  const unlock = () => { audio.unlock(); document.removeEventListener("click", unlock); document.removeEventListener("touchstart", unlock); };
  document.addEventListener("click", unlock);
  document.addEventListener("touchstart", unlock);
}

function applySettingsToUI() {
  $("opt-username").value = settings.username;
  $("opt-sfx").value = settings.sfx;
  $("opt-music").value = settings.music;
  $("opt-sensitivity").value = settings.sensitivity;
  $("opt-shadows").checked = settings.shadows;
  audio.setSfxVolume(settings.sfx / 100);
  audio.setMusicVolume(settings.music / 100);
}

// ---------------- Main Menu ----------------
function bindMainMenu() {
  $("btn-play-solo").addEventListener("click", () => {
    audio.playUiClick();
    startSolo();
  });
  $("btn-multiplayer").addEventListener("click", () => {
    audio.playUiClick();
    showScreen("screen-multiplayer");
  });
  $("btn-settings").addEventListener("click", () => {
    audio.playUiClick();
    showScreen("screen-settings");
  });
}

// ---------------- Settings ----------------
function bindSettings() {
  $("opt-username").addEventListener("change", (e) => {
    settings.username = e.target.value.trim().slice(0, 14) || randomGuestName();
    saveSettings(settings);
  });
  $("opt-sfx").addEventListener("input", (e) => {
    settings.sfx = Number(e.target.value);
    audio.setSfxVolume(settings.sfx / 100);
    saveSettings(settings);
  });
  $("opt-music").addEventListener("input", (e) => {
    settings.music = Number(e.target.value);
    audio.setMusicVolume(settings.music / 100);
    saveSettings(settings);
  });
  $("opt-sensitivity").addEventListener("input", (e) => {
    settings.sensitivity = Number(e.target.value);
    saveSettings(settings);
    if (currentGame?.player) currentGame.player.setSensitivity(settings.sensitivity);
  });
  $("opt-shadows").addEventListener("change", (e) => {
    settings.shadows = e.target.checked;
    saveSettings(settings);
  });
  $("btn-settings-back").addEventListener("click", () => {
    audio.playUiClick();
    showScreen("screen-main");
  });
}

// ---------------- Multiplayer Menu ----------------
function bindMultiplayerMenu() {
  $("btn-mp-back").addEventListener("click", () => {
    audio.playUiClick();
    showScreen("screen-main");
  });

  $("btn-create-room").addEventListener("click", async () => {
    audio.playUiClick();
    try {
      network = new NetworkManager();
      if (!network.available) {
        showToast("Multiplayer isn't configured yet — add your Firebase credentials in js/firebaseConfig.js");
        return;
      }
      const code = await network.createRoom(playerId, settings.username);
      isHostFlag = true;
      $("lobby-code").textContent = code;
      enterLobby();
    } catch (err) {
      console.error(err);
      showToast("Failed to create room. Please try again.");
    }
  });

  $("btn-join-room").addEventListener("click", () => {
    audio.playUiClick();
    $("join-error").textContent = "";
    document.querySelectorAll(".code-box").forEach(b => (b.value = ""));
    showScreen("screen-join");
    document.querySelector('.code-box[data-idx="0"]').focus();
  });
}

// ---------------- Join Room ----------------
function bindJoinRoom() {
  const boxes = Array.from(document.querySelectorAll(".code-box"));
  boxes.forEach((box, idx) => {
    box.addEventListener("input", () => {
      box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (box.value && idx < boxes.length - 1) boxes[idx + 1].focus();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && idx > 0) boxes[idx - 1].focus();
      if (e.key === "Enter") $("btn-do-join").click();
    });
  });

  $("btn-join-back").addEventListener("click", () => {
    audio.playUiClick();
    showScreen("screen-multiplayer");
  });

  $("btn-do-join").addEventListener("click", async () => {
    audio.playUiClick();
    const code = boxes.map(b => b.value).join("");
    if (code.length !== 4) {
      $("join-error").textContent = "Please enter a 4-character room code.";
      return;
    }
    try {
      network = new NetworkManager();
      if (!network.available) {
        $("join-error").textContent = "Multiplayer isn't configured yet.";
        return;
      }
      const room = await network.joinRoom(code, playerId, settings.username);
      isHostFlag = room.host === playerId;
      $("lobby-code").textContent = code;
      enterLobby();
    } catch (err) {
      if (err.message === "NOT_FOUND") $("join-error").textContent = "Room not found.";
      else if (err.message === "FULL") $("join-error").textContent = "Room is full.";
      else if (err.message === "IN_PROGRESS") $("join-error").textContent = "That game has already started.";
      else $("join-error").textContent = "Something went wrong. Try again.";
    }
  });
}

// ---------------- Lobby ----------------
function enterLobby() {
  showScreen("screen-lobby");
  network.onRoomUpdate(renderLobby);
}

function renderLobby(roomData) {
  if (!roomData) {
    showToast("The host left. Returning to menu.");
    showScreen("screen-main");
    return;
  }
  lastRoomSnapshot = roomData;

  if (roomData.status === "playing") {
    launchMultiplayerGame(roomData);
    return;
  }

  const container = $("lobby-players");
  container.innerHTML = "";
  const players = Object.entries(roomData.players || {})
    .sort((a, b) => (a[1].joinOrder ?? 0) - (b[1].joinOrder ?? 0));

  for (const [pid, p] of players) {
    const row = document.createElement("div");
    row.className = "lobby-player-row";
    const dot = p.connected ? "🟢" : "⚪";
    row.innerHTML = `<span class="dot">${dot}</span><span>${escapeHtml(p.username || "Player")}</span>${pid === roomData.host ? '<span class="host-tag">HOST</span>' : ""}`;
    container.appendChild(row);
  }
  for (let i = players.length; i < 4; i++) {
    const row = document.createElement("div");
    row.className = "lobby-player-row";
    row.innerHTML = `<span class="dot">⚪</span><span>Waiting...</span>`;
    container.appendChild(row);
  }

  const amHost = roomData.host === playerId;
  const connectedCount = players.filter(([, p]) => p.connected).length;
  $("btn-start-game").style.display = amHost ? "block" : "none";
  $("btn-start-game").disabled = connectedCount < 2;
  $("lobby-hint").textContent = amHost
    ? (connectedCount < 2 ? "Need at least 2 players to start." : "Ready to start!")
    : "Waiting for host to start\u2026";
}

function bindLobby() {
  $("btn-start-game").addEventListener("click", async () => {
    audio.playUiClick();
    await network.startGame();
  });
  $("btn-lobby-leave").addEventListener("click", async () => {
    audio.playUiClick();
    await network?.leaveRoom();
    showScreen("screen-multiplayer");
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------- Game Launch (Solo) ----------------
function startSolo() {
  menuBg?.destroy(); menuBg = null;
  showScreen("screen-game");
  screens["screen-game"].classList.add("active");
  setupGameUiChrome({ multiplayer: false });

  const canvas = $("game-canvas");
  currentGame = new SoloGame({
    canvas,
    settings,
    onGameOver: (result) => showEndScreen({
      title: "TOWER COLLAPSED!",
      subtitle: "Solo Run Complete",
      finalHeight: result.finalHeight,
      scoreboard: [{ username: settings.username, score: result.score, isMe: true }],
      isSolo: true
    })
  });
  audio.startMusic();
}

// ---------------- Game Launch (Multiplayer) ----------------
function launchMultiplayerGame(roomData) {
  if (currentGame) return; // already launched
  showScreen("screen-game");
  setupGameUiChrome({ multiplayer: true });

  const canvas = $("game-canvas");
  currentGame = new MultiplayerGame({
    canvas,
    settings,
    network,
    room: roomData,
    onGameOver: (result) => {
      const scoreboard = (result.scoreboard || []).map(s => ({
        ...s, isMe: s.id === playerId
      }));
      const winner = scoreboard.find(s => s.id === result.winnerId);
      showEndScreen({
        title: "TOWER COLLAPSED!",
        subtitle: winner ? `${winner.username.toUpperCase()} WINS!` : "GAME OVER",
        finalHeight: result.finalHeight,
        scoreboard,
        isSolo: false
      });
    }
  });
  audio.startMusic();
}

// ---------------- Shared Game UI Chrome ----------------
function setupGameUiChrome({ multiplayer }) {
  $("turn-banner").style.display = multiplayer ? "block" : "none";
  $("mobile-controls").style.display = isMobileDevice() ? "flex" : "none";
  $("timing-ui").style.display = "none";
  $("carry-hint").style.display = "none";
  $("pause-menu").style.display = "none";
}

function bindGameControls() {
  $("btn-pause").addEventListener("click", () => {
    audio.playUiClick();
    $("pause-menu").style.display = "flex";
    currentGame?.setPaused(true);
    if (document.pointerLockElement) document.exitPointerLock();
  });
  $("btn-resume").addEventListener("click", () => {
    audio.playUiClick();
    $("pause-menu").style.display = "none";
    currentGame?.setPaused(false);
  });
  $("btn-quit-to-menu").addEventListener("click", async () => {
    audio.playUiClick();
    await teardownGame();
    if (network) { await network.leaveRoom(); network = null; }
    returnToMainMenu();
  });
}

async function teardownGame() {
  audio.stopMusic();
  currentGame?.destroy();
  currentGame = null;
  $("pause-menu").style.display = "none";
}

function returnToMainMenu() {
  showScreen("screen-main");
  if (!menuBg) menuBg = new MenuBackground($("menu-bg-canvas"));
}

// ---------------- End Screen ----------------
function showEndScreen({ title, subtitle, finalHeight, scoreboard, isSolo }) {
  showScreen("screen-end");
  $("end-title").textContent = title;
  $("end-subtitle").textContent = subtitle;
  $("end-height").textContent = `Final Height: ${finalHeight} Blocks`;

  const sorted = [...scoreboard].sort((a, b) => (b.score || 0) - (a.score || 0));
  const board = $("end-scoreboard");
  board.innerHTML = "";
  sorted.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "score-row" + (i === 0 && !isSolo ? " winner" : "");
    row.innerHTML = `<span>${escapeHtml(s.username || "Player")}${s.isMe ? " (You)" : ""}</span><span>${formatNumber(s.score || 0)}${i === 0 && !isSolo ? '<span class="crown">👑</span>' : ""}</span>`;
    board.appendChild(row);
  });

  $("btn-return-lobby").style.display = isSolo ? "none" : "inline-block";
  $("btn-rematch").style.display = isSolo ? "none" : "inline-block";
}

function bindEndScreen() {
  $("btn-rematch").addEventListener("click", async () => {
    audio.playUiClick();
    if (!network) return;
    await network.voteRematch();
    // Host resets the room once ready (simplified: host triggers reset immediately)
    if (isHostFlag) {
      await network.resetForRematch({});
    }
    await teardownGame();
    showScreen("screen-lobby");
    network.onRoomUpdate(renderLobby);
  });

  $("btn-return-lobby").addEventListener("click", async () => {
    audio.playUiClick();
    await teardownGame();
    if (network) {
      showScreen("screen-lobby");
      network.onRoomUpdate(renderLobby);
    } else {
      returnToMainMenu();
    }
  });

  $("btn-end-main-menu").addEventListener("click", async () => {
    audio.playUiClick();
    await teardownGame();
    if (network) { await network.leaveRoom(); network = null; }
    returnToMainMenu();
  });
}

// ---------------- Boot ----------------
init();
