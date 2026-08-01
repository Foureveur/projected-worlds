/**
 * main.js (écran de jeu)
 * ----------------------
 * - se connecte au serveur en tant qu'"écran"
 * - affiche le salon (QR code + code de room) en attendant 2 manettes
 * - gère la sélection des personnages
 * - lance la boucle de jeu à pas fixe (60 Hz) et le rendu
 * - renvoie son + vibrations aux bonnes manettes
 * - clavier de secours pour tester à 2 sur un seul PC
 */

import { TICK_MS } from './constants.js';
import { Engine } from './engine.js';
import { Renderer } from './renderer.js';
import { AudioFx } from './audio.js';
import { CHARACTER_LIST, getCharacter } from './characters.js';

const $ = (sel) => document.querySelector(sel);

const canvas = $('#game');
const renderer = new Renderer(canvas);
const audio = new AudioFx();

let ws = null;
let room = null;
let paused = false;
let mode = 'lobby'; // 'lobby' | 'playing'

const selection = {
  p1: { connected: false, charIdx: 0, ready: false },
  p2: { connected: false, charIdx: 1, ready: false },
};

const engine = new Engine({
  onEvent: (type, data) => {
    audio.play(type, data);
    handleHaptics(type, data);
  },
});

// ------------------------------------------------------------------
// Réseau
// ------------------------------------------------------------------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.addEventListener('open', () => {
    send({ t: 'hello', role: 'screen' });
  });
  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    onMessage(msg);
  });
  ws.addEventListener('close', () => {
    setTimeout(connect, 1000); // reconnexion auto
  });
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      room = msg.room;
      showLobby(msg);
      break;
    case 'player-join':
      selection[msg.slot].connected = true;
      selection[msg.slot].ready = false;
      updateLobby();
      break;
    case 'player-leave':
      selection[msg.slot].connected = false;
      selection[msg.slot].ready = false;
      if (mode === 'playing') { paused = true; }
      updateLobby();
      break;
    case 'select':
      if (msg.from && typeof msg.charIdx === 'number') {
        selection[msg.from].charIdx = msg.charIdx;
        updateLobby();
      }
      break;
    case 'ready':
      if (msg.from) {
        selection[msg.from].ready = !!msg.ready;
        updateLobby();
        maybeStart();
      }
      break;
    case 'input':
      onControllerInput(msg.from, msg.btn, msg.down);
      break;
  }
}

function onControllerInput(slot, btn, down) {
  if (!slot) return;
  // En fin de match, ⚡ Spécial relance une revanche.
  if (mode === 'playing' && engine.phase === 'matchEnd') {
    if (btn === 'special' && down) restartMatch();
    return;
  }
  if (mode === 'playing' && !paused) engine.setInput(slot, btn, down);
}

// ------------------------------------------------------------------
// Salon / sélection
// ------------------------------------------------------------------
function showLobby(welcome) {
  $('#lobby').classList.remove('hidden');
  $('#roomCode').textContent = welcome.room;
  $('#joinUrl').textContent = welcome.joinUrl;
  $('#qr').src = `/qr?text=${encodeURIComponent(welcome.joinUrl)}`;
  updateLobby();
}

function updateLobby() {
  for (const slot of ['p1', 'p2']) {
    const s = selection[slot];
    const card = $(`#card-${slot}`);
    const char = CHARACTER_LIST[s.charIdx];
    card.querySelector('.char-name').textContent = char.name;
    card.querySelector('.char-sub').textContent = char.formNames.join(' › ');
    card.classList.toggle('connected', s.connected);
    card.classList.toggle('ready', s.ready);
    const status = card.querySelector('.status');
    if (!s.connected) status.textContent = 'En attente du téléphone…';
    else if (s.ready) status.textContent = '✓ PRÊT';
    else status.textContent = 'Choisis ton perso puis PRÊT';
  }
}

function maybeStart() {
  const a = selection.p1, b = selection.p2;
  if (a.connected && b.connected && a.ready && b.ready && mode === 'lobby') {
    startGame();
  }
}

function startGame() {
  audio.init();
  audio.startMusic('battle');
  mode = 'playing';
  paused = false;
  $('#lobby').classList.add('hidden');
  engine.configure(
    CHARACTER_LIST[selection.p1.charIdx].id,
    CHARACTER_LIST[selection.p2.charIdx].id
  );
  broadcastState(true);
}

function restartMatch() {
  audio.startMusic('battle');
  engine.rematch();
  broadcastState(true);
}

// ------------------------------------------------------------------
// Vibrations & état vers les manettes
// ------------------------------------------------------------------
function handleHaptics(type, data) {
  if (type === 'hit') {
    buzz(data.slot, data.heavy ? [45] : [20]);           // la victime encaisse
    if (data.atk) buzz(data.atk, data.heavy ? [12] : [6]); // l'attaquant sent le contact
  } else if (type === 'block') {
    buzz(data.slot, [8]);
  } else if (type === 'throw') {
    buzz(data.slot, [70, 30, 90]);                        // grosse projection
    if (data.atk) buzz(data.atk, [15]);
  } else if (type === 'armor') {
    buzz(data.slot, [12, 15]);                            // clang d'armure
  } else if (type === 'dash') {
    buzz(data.slot, [7]);
  } else if (type === 'transform') {
    buzz(data.slot, [30, 40, 60, 40, 90]);               // montée en rage
    pushState(data.slot);
  } else if (type === 'ko') {
    buzz(data.slot, [90]);
  } else if (type === 'match-end') {
    buzz(data.slot, [40, 60, 40, 60, 40, 120]);
  }
}

function buzz(slot, pattern) {
  if (!slot) return;
  send({ t: 'buzz', to: slot, pattern });
}

let stateTick = 0;
function broadcastState(force = false) {
  pushState('p1', force);
  pushState('p2', force);
}

function pushState(slot, force = false) {
  const f = engine.fighters[slot];
  if (!f) return;
  send({
    t: 'state', to: slot,
    health: Math.round(f.health),
    rage: Math.round(f.rage),
    form: f.formIndex,
    formName: f.char.formNames[f.formIndex],
    charName: f.char.name,
    specialName: f.char.specials[f.formIndex].name,
    phase: engine.phase,
  });
}

// ------------------------------------------------------------------
// Boucle de jeu (pas fixe 60 Hz)
// ------------------------------------------------------------------
let acc = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = now - last; last = now;
  if (dt > 250) dt = 250;
  acc += dt;
  let steps = 0;
  while (acc >= TICK_MS && steps < 5) {
    if (mode === 'playing' && !paused) engine.update();
    acc -= TICK_MS;
    steps++;
  }
  renderer.render(engine);

  if (mode === 'playing') {
    // Intensité musicale = niveau de rage max des deux combattants
    const p1 = engine.fighters.p1, p2 = engine.fighters.p2;
    if (p1 && p2) audio.setMusicIntensity(Math.max(p1.formIndex, p2.formIndex) / 2);
    // Musique plus calme à la fin du match
    if (engine.phase === 'matchEnd' && audio.music.track === 'battle') audio.startMusic('menu');

    // Envoi périodique de l'état aux manettes (~12 Hz)
    if (!paused) {
      stateTick++;
      if (stateTick % 5 === 0) broadcastState();
    }
  }
}
requestAnimationFrame(frame);

// Exposé pour le debug depuis la console du navigateur (ex: window.__engine)
window.__engine = engine;
window.__renderer = renderer;

// ------------------------------------------------------------------
// Clavier de secours (test à 2 sur un PC)
//   J1 : A/D=déplacer, W=saut, S=accroupi, F=coup, G=pied, H=spécial, V=garde
//   J2 : ←/→, ↑, ↓, J=coup, K=pied, L=spécial, N=garde
// ------------------------------------------------------------------
const KEYMAP = {
  KeyA: ['p1', 'left'], KeyD: ['p1', 'right'], KeyW: ['p1', 'up'], KeyS: ['p1', 'down'],
  KeyF: ['p1', 'punch'], KeyG: ['p1', 'kick'], KeyH: ['p1', 'special'], KeyV: ['p1', 'block'],
  ArrowLeft: ['p2', 'left'], ArrowRight: ['p2', 'right'], ArrowUp: ['p2', 'up'], ArrowDown: ['p2', 'down'],
  KeyJ: ['p2', 'punch'], KeyK: ['p2', 'kick'], KeyL: ['p2', 'special'], KeyN: ['p2', 'block'],
};
const keyHeld = {};
window.addEventListener('keydown', (e) => {
  audio.init();
  if (e.code === 'KeyM') { const muted = audio.toggleMute(); showToast(muted ? '🔇 Son coupé' : '🔊 Son activé'); return; }
  const m = KEYMAP[e.code];
  if (!m) {
    if (e.code === 'Enter' && engine.phase === 'matchEnd') restartMatch();
    return;
  }
  e.preventDefault();
  if (keyHeld[e.code]) return;
  keyHeld[e.code] = true;
  // Le clavier permet aussi de tester sans téléphone : on marque les
  // deux joueurs comme connectés/prêts et on démarre au premier appui.
  if (mode === 'lobby') { forceKeyboardStart(); }
  if (engine.phase === 'matchEnd' && m[1] === 'special') { restartMatch(); return; }
  engine.setInput(m[0], m[1], true);
});
window.addEventListener('keyup', (e) => {
  const m = KEYMAP[e.code];
  if (!m) return;
  keyHeld[e.code] = false;
  engine.setInput(m[0], m[1], false);
});

let keyboardStarted = false;
function forceKeyboardStart() {
  if (keyboardStarted) return;
  keyboardStarted = true;
  selection.p1.connected = selection.p2.connected = true;
  audio.init();
  audio.startMusic('battle');
  mode = 'playing';
  paused = false;
  $('#lobby').classList.add('hidden');
  engine.configure(CHARACTER_LIST[selection.p1.charIdx].id, CHARACTER_LIST[selection.p2.charIdx].id);
}

// Petit toast d'info (mute, etc.)
let toastTimer = null;
function showToast(text) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1030;color:#f5d90a;padding:10px 18px;border-radius:8px;font-family:monospace;font-size:14px;z-index:50;border:2px solid #f5d90a;';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 1400);
}

// Débloque l'audio + lance la musique du menu au premier contact
window.addEventListener('pointerdown', () => {
  audio.init();
  if (mode === 'lobby') audio.startMusic('menu');
}, { once: true });

connect();
