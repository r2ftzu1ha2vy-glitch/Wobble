# WOBBLE

A 3D first-person physics tower game (Jenga-inspired) with a skill-based timing
mechanic, solo play, and real-time multiplayer via Firebase Realtime Database.

Built with **Three.js** (rendering), **cannon-es** (physics), and **Firebase
Realtime Database** (multiplayer sync). No build step required — everything
runs directly in the browser via ES modules and CDN-hosted libraries.

---

## Running locally

Because the game uses ES modules (`type="module"`), it must be served over
HTTP (not opened directly as a `file://` URL). Any static file server works:

```bash
# Python
python3 -m http.server 8080

# Node (if you have `serve` installed)
npx serve .
```

Then open `http://localhost:8080` in your browser.

---

## Setting up multiplayer (Firebase)

Multiplayer requires a free Firebase project with **Realtime Database**
enabled.

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   create a new project.
2. In the project, go to **Build → Realtime Database** and click
   **Create Database** (start in test mode for local development).
3. Go to **Project settings → General → Your apps**, add a Web app, and copy
   the config object it gives you.
4. Open `js/firebaseConfig.js` and replace the placeholder values with your
   project's config:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "",              // not used — Firebase Storage is not required
  messagingSenderId: "...",
  appId: "..."
};
```

5. (Recommended) Update your Realtime Database security rules so rooms are
   readable/writable while your game is live. A simple starting point for
   development:

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```
   Tighten these rules before shipping publicly (e.g. validate data shape,
   expire old rooms, rate-limit writes).

**Firebase Storage is intentionally not used anywhere in this project.**

If `js/firebaseConfig.js` is left with its placeholder values, **Solo mode
still works fully** — only the Multiplayer menu will show a toast explaining
that multiplayer isn't configured yet.

---

## Deploying as a static site

Wobble is a fully static site (HTML/CSS/JS + CDN libraries), so it can be
deployed anywhere that serves static files:

- **Firebase Hosting**: `firebase init hosting` → point it at this folder →
  `firebase deploy`
- **GitHub Pages**: push this folder to a repo and enable Pages on the
  `main` branch
- **Netlify / Vercel**: drag-and-drop deploy or connect the repo, no build
  command needed (framework preset: "Other" / static)

---

## Project structure

```
index.html              Screens: menu, settings, multiplayer, lobby, game HUD, end screen
css/style.css            All UI styling
js/
  main.js                 App bootstrap & screen/navigation controller
  utils.js                 Small shared helpers (settings, room codes, DOM helpers)
  audio.js                 Procedural WebAudio sound effects + music (no assets required)
  firebaseConfig.js        Firebase project config — EDIT THIS to enable multiplayer
  network.js               Firebase Realtime Database networking layer
  tower.js                 Physics tower (cannon-es) + block meshes (three.js)
  environment.js            Room, lighting, atmosphere
  playerController.js       First-person movement (desktop pointer-lock + mobile joystick)
  timingGame.js             Timing minigame (moving indicator / green zone)
  scoring.js                 Score/combo/height/best tracking
  soloGame.js                Solo mode game loop
  multiplayerGame.js         Multiplayer mode game loop (turn-based, tower synced via Firebase)
  menuBackground.js          Small ambient 3D scene behind the main menu
assets/sounds/            Optional folder for real audio files (see assets/sounds/README.txt)
```

## Controls

**Desktop**: Click to lock the mouse and look around, `WASD`/arrow keys to
move, click to select a block / attempt timing / place a block.

**Mobile**: On-screen joystick (bottom-left) to move, drag anywhere else to
look around, tap the round action button (bottom-right) to select / time /
place.
