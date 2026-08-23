// ============================================================
// UTILS — small shared helper functions
// ============================================================

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
export function generateRoomCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export function generatePlayerId() {
  return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString();
}

let toastTimer = null;
export function showToast(message, duration = 2400) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}

export function $(id) {
  return document.getElementById(id);
}

export function isMobileDevice() {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 1 && window.innerWidth < 900)
  );
}

// Simple persistent local settings store
const SETTINGS_KEY = "wobble_settings_v1";
const defaultSettings = {
  username: "",
  sfx: 80,
  music: 40,
  sensitivity: 100,
  shadows: true
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export function randomGuestName() {
  const adjectives = ["Wobbly", "Sneaky", "Steady", "Clumsy", "Nimble", "Bold", "Lucky", "Quiet"];
  const nouns = ["Otter", "Badger", "Falcon", "Panda", "Fox", "Wolf", "Sparrow", "Yak"];
  return (
    adjectives[Math.floor(Math.random() * adjectives.length)] +
    nouns[Math.floor(Math.random() * nouns.length)] +
    Math.floor(Math.random() * 90 + 10)
  );
}
