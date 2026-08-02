/**
 * main.js (écran de jeu)
 * ----------------------
 * - devient l'HÔTE peer-to-peer (les manettes s'y connectent en direct)
 * - affiche le salon (QR code + code de partie) en attendant les manettes
 * - choix du MODE : Versus (1v1) ou Smash (2-4, mêlée générale)
 * - gère la sélection des personnages
 * - lance la boucle de jeu à pas fixe (60 Hz) et le rendu
 * - renvoie son + vibrations aux bonnes manettes
 * - clavier de secours pour tester sur un seul PC
 */

import { TICK_MS } from './constants.js';
import { Engine } from './engine.js';
import { SmashEngine } from './smash.js';
import { StreetsEngine } from './streets.js';
import { Renderer } from './renderer.js';
import { AudioFx } from './audio.js';
import { CHARACTER_LIST } from './characters.js';
import { AIController } from './ai.js';
import * as Net from '../net/peernet.js';

const $ = (sel) => document.querySelector(sel);
const SLOTS4 = ['p1', 'p2', 'p3', 'p4'];

const canvas = $('#game');
const renderer = new Renderer(canvas);
const audio = new AudioFx();

let net = null;
let room = null;
let paused = false;
let mode = 'lobby';    // 'lobby' | 'playing'
let gameMode = 'versus'; // 'versus' | 'smash' | 'sor'
let botsCount = 1;       // bots CPU à ajouter en smash
let alliesCount = 1;     // alliés CPU en co-op streets
let ais = [];            // IA actives (solo versus ou bots smash)
let soloMode = false;
let humanSlot = null;    // slot du joueur humain en solo

const selection = {
  p1: { connected: false, charIdx: 0, ready: false },
  p2: { connected: false, charIdx: 1, ready: false },
  p3: { connected: false, charIdx: 2, ready: false },
  p4: { connected: false, charIdx: 3, ready: false },
};

// Deux moteurs partageant les mêmes retours (son + vibrations)
const hooks = {
  onEvent: (type, data) => { audio.play(type, data); handleHaptics(type, data); },
};
const versus = new Engine(hooks);
const smash = new SmashEngine(hooks);
const streets = new StreetsEngine(hooks);
let active = versus; // moteur en cours (rendu / entrées / diffusion d'état)

// Phases de fin, communes aux 3 modes (pour la revanche via ⚡)
const isEnded = (e) => ['matchEnd', 'gameover', 'clear'].includes(e.phase);

// ------------------------------------------------------------------
// Réseau (hôte peer-to-peer)
// ------------------------------------------------------------------
async function startHost() {
  try {
    net = await Net.host({
      onReady: ({ roomCode, joinUrl }) => { room = roomCode; showLobby(roomCode, joinUrl); },
      onJoin: (slot) => { selection[slot].connected = true; selection[slot].ready = false; updateLobby(); },
      onLeave: (slot) => {
        selection[slot].connected = false; selection[slot].ready = false;
        if (mode === 'playing' && gameMode === 'versus') paused = true;
        updateLobby();
      },
      onMessage: (slot, msg) => onControllerMessage(slot, msg),
      onError: (err) => console.warn('[net]', err),
    });
  } catch (e) {
    console.error('Impossible de démarrer l\'hôte', e);
    const el = $('#roomCode'); if (el) el.textContent = 'ERR';
  }
}

function onControllerMessage(slot, msg) {
  if (!msg) return;
  switch (msg.t) {
    case 'select':
      if (typeof msg.charIdx === 'number') { selection[slot].charIdx = msg.charIdx; updateLobby(); }
      break;
    case 'ready':
      selection[slot].ready = !!msg.ready; updateLobby(); maybeStart();
      break;
    case 'solo':
      startSolo(slot);
      break;
    case 'input':
      onControllerInput(slot, msg.btn, msg.down);
      break;
  }
}

function onControllerInput(slot, btn, down) {
  if (!slot) return;
  if (soloMode && slot !== humanSlot) return; // en solo, une seule manette pilote
  if (mode === 'playing' && isEnded(active)) {
    if (btn === 'special' && down) restartMatch();
    return;
  }
  if (mode === 'playing' && !paused) active.setInput(slot, btn, down);
}

// ------------------------------------------------------------------
// Salon / sélection
// ------------------------------------------------------------------
function showLobby(roomCode, joinUrl) {
  $('#lobby').classList.remove('hidden');
  $('#roomCode').textContent = roomCode;
  $('#joinUrl').textContent = joinUrl;
  renderQR(joinUrl, $('#qr'));
  updateLobby();
}

// Génère le QR code côté client (aucun serveur requis)
function renderQR(text, imgEl) {
  if (!imgEl || typeof qrcode === 'undefined') return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = 6, margin = 2;
    const size = (count + margin * 2) * cell;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#f5d90a'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#1a1030';
    for (let r = 0; r < count; r++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(r, col)) g.fillRect((col + margin) * cell, (r + margin) * cell, cell, cell);
      }
    }
    imgEl.src = c.toDataURL();
  } catch (e) { console.warn('qr', e); }
}

function connectedSlots() { return SLOTS4.filter((s) => selection[s].connected); }

function updateLobby() {
  const shown = (gameMode === 'smash' || gameMode === 'sor') ? SLOTS4 : ['p1', 'p2'];
  for (const slot of SLOTS4) {
    const card = $(`#card-${slot}`);
    if (!card) continue;
    const visible = shown.includes(slot);
    card.classList.toggle('hidden', !visible);
    if (!visible) continue;
    const s = selection[slot];
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

  // Boutons de mode
  document.querySelectorAll('.gmode-opt').forEach((b) => b.classList.toggle('active', b.dataset.gmode === gameMode));
  document.querySelectorAll('.bots-opt').forEach((b) => b.classList.toggle('active', Number(b.dataset.bots) === botsCount));
  document.querySelectorAll('.allies-opt').forEach((b) => b.classList.toggle('active', Number(b.dataset.allies) === alliesCount));

  // Panneaux spécifiques
  const smashCtrls = $('#smashCtrls'); if (smashCtrls) smashCtrls.classList.toggle('hidden', gameMode !== 'smash');
  const streetsCtrls = $('#streetsCtrls'); if (streetsCtrls) streetsCtrls.classList.toggle('hidden', gameMode !== 'sor');
  const rounds = $('#roundsRow'); if (rounds) rounds.classList.toggle('hidden', gameMode !== 'versus');

  // État du bouton LANCER (smash)
  const startBtn = $('#startSmash');
  if (startBtn) {
    const total = Math.min(4, connectedSlots().length + botsCount);
    startBtn.disabled = !(gameMode === 'smash' && total >= 2);
    startBtn.textContent = `LANCER SMASH (${total} combattants)`;
  }
  // État du bouton LANCER CO-OP (streets)
  const sorBtn = $('#startStreets');
  if (sorBtn) {
    const total = Math.min(4, connectedSlots().length + alliesCount);
    sorBtn.disabled = !(gameMode === 'sor' && total >= 1);
    sorBtn.textContent = `LANCER CO-OP (${total} héros)`;
  }
}

function setGameMode(m) {
  if (mode !== 'lobby') return;
  gameMode = m;
  updateLobby();
}

function maybeStart() {
  if (mode !== 'lobby') return;
  if (gameMode === 'versus') {
    const a = selection.p1, b = selection.p2;
    if (a.connected && b.connected && a.ready && b.ready) startVersus();
  } else if (gameMode === 'smash') {
    const humans = connectedSlots();
    const total = Math.min(4, humans.length + botsCount);
    if (humans.length >= 1 && humans.every((s) => selection[s].ready) && total >= 2) startSmash();
  } else if (gameMode === 'sor') {
    const humans = connectedSlots();
    if (humans.length >= 1 && humans.every((s) => selection[s].ready)) startStreets();
  }
}

function startVersus() {
  audio.init();
  audio.startMusic('battle');
  active = versus; window.__engine = versus;
  versus.viewW = renderer.resize();
  mode = 'playing';
  paused = false;
  ais = [];
  $('#lobby').classList.add('hidden');
  versus.configure(
    CHARACTER_LIST[selection.p1.charIdx].id,
    CHARACTER_LIST[selection.p2.charIdx].id
  );
  broadcastState(true);
}

function startSmash() {
  const humans = connectedSlots();
  const total = Math.min(4, humans.length + botsCount);
  if (total < 2) return;
  audio.init();
  audio.startMusic('battle');

  const entries = [];
  const used = new Set();
  humans.forEach((s) => { entries.push({ slot: s, charId: CHARACTER_LIST[selection[s].charIdx].id, cpu: false }); used.add(s); });
  const botChars = ['darkmeregrand', 'darkpadre', 'meregrand', 'padre'];
  let bi = 0;
  for (const s of SLOTS4) {
    if (entries.length >= total) break;
    if (used.has(s)) continue;
    entries.push({ slot: s, charId: botChars[bi % botChars.length], cpu: true }); used.add(s); bi++;
  }
  entries.sort((a, b) => SLOTS4.indexOf(a.slot) - SLOTS4.indexOf(b.slot));

  active = smash; window.__engine = smash;
  smash.viewW = renderer.resize();
  mode = 'playing';
  paused = false;
  soloMode = false;
  $('#lobby').classList.add('hidden');
  smash.configure(entries);
  ais = entries.filter((e) => e.cpu).map((e) => new AIController(e.slot, null, 1));
  broadcastState(true);
}

function startStreets() {
  const humans = connectedSlots();
  if (humans.length < 1) return;
  const total = Math.min(4, humans.length + alliesCount);
  audio.init();
  audio.startMusic('battle');

  const entries = [];
  const used = new Set();
  humans.forEach((s) => { entries.push({ slot: s, charId: CHARACTER_LIST[selection[s].charIdx].id, cpu: false }); used.add(s); });
  const allyChars = ['padre', 'meregrand', 'padre'];
  let ai = 0;
  for (const s of SLOTS4) {
    if (entries.length >= total) break;
    if (used.has(s)) continue;
    entries.push({ slot: s, charId: allyChars[ai % allyChars.length], cpu: true }); used.add(s); ai++;
  }
  entries.sort((a, b) => SLOTS4.indexOf(a.slot) - SLOTS4.indexOf(b.slot));

  active = streets; window.__engine = streets;
  streets.viewW = renderer.resize();
  mode = 'playing';
  paused = false;
  soloMode = false;
  ais = []; // l'IA (ennemis + alliés) est interne au moteur streets
  $('#lobby').classList.add('hidden');
  streets.configure(entries);
  broadcastState(true);
}

function restartMatch() {
  audio.startMusic('battle');
  active.rematch();
  broadcastState(true);
}

// --- Mode 1 joueur versus (vs CPU) ---
function startSolo(slot) {
  if (gameMode === 'smash') { // en smash, "solo" = smash contre les bots
    selection[slot].connected = true; selection[slot].ready = true;
    maybeStart();
    return;
  }
  audio.init();
  audio.startMusic('battle');
  humanSlot = slot;
  soloMode = true;
  const cpuSlot = slot === 'p1' ? 'p2' : 'p1';
  const humanIdx = selection[slot].charIdx;
  selection[slot].connected = true;
  selection[cpuSlot].charIdx = (humanIdx + 1) % CHARACTER_LIST.length;
  active = versus; window.__engine = versus;
  versus.viewW = renderer.resize();
  mode = 'playing';
  paused = false;
  $('#lobby').classList.add('hidden');
  versus.configure(CHARACTER_LIST[selection.p1.charIdx].id, CHARACTER_LIST[selection.p2.charIdx].id);
  ais = [new AIController(cpuSlot, slot, 1)];
  broadcastState(true);
}

// ------------------------------------------------------------------
// Vibrations & état vers les manettes
// ------------------------------------------------------------------
function handleHaptics(type, data) {
  if (type === 'hit') {
    buzz(data.slot, data.heavy ? [45] : [20]);
    if (data.atk) buzz(data.atk, data.heavy ? [12] : [6]);
  } else if (type === 'block') {
    buzz(data.slot, [8]);
  } else if (type === 'throw') {
    buzz(data.slot, [70, 30, 90]);
    if (data.atk) buzz(data.atk, [15]);
  } else if (type === 'armor') {
    buzz(data.slot, [12, 15]);
  } else if (type === 'dash') {
    buzz(data.slot, [7]);
  } else if (type === 'transform') {
    buzz(data.slot, [30, 40, 60, 40, 90]);
    pushState(data.slot);
  } else if (type === 'ko') {
    buzz(data.slot, [90]);
  } else if (type === 'match-end') {
    buzz(data.slot, [40, 60, 40, 60, 40, 120]);
  }
}

function buzz(slot, pattern) {
  if (!slot || !net) return;
  net.send(slot, { t: 'buzz', pattern });
}

let stateTick = 0;
function broadcastState(force = false) {
  const fs = active.fighters;
  for (const slot of Object.keys(fs)) pushState(slot, force);
}

function pushState(slot) {
  const f = active.fighters[slot];
  if (!f || !net) return;
  if (active.mode === 'streets') {
    // Beat'em up : santé ramenée sur 100, vies = stocks
    net.send(slot, {
      t: 'state', mode: 'streets',
      health: Math.round((f.hp / f.maxHp) * 100),
      rage: 0, form: 0,
      formName: f.char.name, charName: f.char.name,
      specialName: f.char.specials[0].name,
      specialLocked: f.specialCd > 0,
      phase: active.phase,
      stocks: f.lives,
      eliminated: !!f.spectator,
    });
    return;
  }
  net.send(slot, {
    t: 'state',
    health: Math.round(f.health),
    rage: Math.round(f.rage),
    form: f.formIndex,
    formName: f.char.formNames[f.formIndex],
    charName: f.char.name,
    specialName: f.char.specials[f.formIndex].name,
    specialLocked: f.specialLock > 0,
    phase: active.phase,
    mode: active.mode,
    stocks: typeof f.stocks === 'number' ? f.stocks : null,
    eliminated: !!f.eliminated,
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
    if (mode === 'playing' && !paused) {
      for (const a of ais) a.update(active);
      active.update();
    }
    acc -= TICK_MS;
    steps++;
  }
  renderer.render(active);

  if (mode === 'playing') {
    const fs = active.fighterList;
    if (fs.length) {
      const maxForm = Math.max(...fs.map((f) => f.formIndex));
      audio.setMusicIntensity(maxForm / 2);
    }
    if (isEnded(active) && audio.music.track === 'battle') audio.startMusic('menu');
    if (!paused) {
      stateTick++;
      if (stateTick % 5 === 0) broadcastState();
    }
  }
}
requestAnimationFrame(frame);

window.__engine = active;
window.__renderer = renderer;
window.__versus = versus;
window.__smash = smash;
window.__streets = streets;

// Résolution dynamique : le canvas remplit l'écran, sans bandes ni déformation
function handleResize() {
  const w = renderer.resize();
  versus.viewW = w; smash.viewW = w; streets.viewW = w;
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 150));
handleResize();

// Sélecteur du mode de jeu (Versus / Smash)
document.querySelectorAll('.gmode-opt').forEach((b) => {
  if (b.disabled) return;
  b.addEventListener('click', () => setGameMode(b.dataset.gmode));
});
// Sélecteur du nombre de bots (smash)
document.querySelectorAll('.bots-opt').forEach((b) => {
  b.addEventListener('click', () => { botsCount = Number(b.dataset.bots); updateLobby(); });
});
// Sélecteur du nombre d'alliés CPU (streets)
document.querySelectorAll('.allies-opt').forEach((b) => {
  b.addEventListener('click', () => { alliesCount = Number(b.dataset.allies); updateLobby(); });
});
// Boutons LANCER
const startSmashBtn = $('#startSmash');
if (startSmashBtn) startSmashBtn.addEventListener('click', () => startSmash());
const startStreetsBtn = $('#startStreets');
if (startStreetsBtn) startStreetsBtn.addEventListener('click', () => startStreets());

// Sélecteur du nombre de manches gagnantes (versus)
document.querySelectorAll('.round-opt').forEach((b) => {
  b.addEventListener('click', () => {
    versus.roundsToWin = Number(b.dataset.rounds);
    document.querySelectorAll('.round-opt').forEach((o) => o.classList.toggle('active', o === b));
  });
});

// ------------------------------------------------------------------
// Clavier de secours (test sur un PC)
//   J1 : A/D=déplacer, W=saut, S=accroupi, F=coup, G=pied, H=spécial, V=garde
//   J2 : ←/→, ↑, ↓, J=coup, K=pied, L=spécial, N=garde
//   C  = solo versus vs CPU · B = smash (toi + bots) · M = mute
// ------------------------------------------------------------------
const KEYMAP = {
  KeyA: ['p1', 'left'], KeyD: ['p1', 'right'], KeyW: ['p1', 'up'], KeyS: ['p1', 'down'],
  KeyF: ['p1', 'punch'], KeyG: ['p1', 'kick'], KeyH: ['p1', 'special'], KeyV: ['p1', 'block'],
  Space: ['p1', 'jump'], // saut dédié (utile en streets où ↑/↓ = profondeur)
  ArrowLeft: ['p2', 'left'], ArrowRight: ['p2', 'right'], ArrowUp: ['p2', 'up'], ArrowDown: ['p2', 'down'],
  KeyJ: ['p2', 'punch'], KeyK: ['p2', 'kick'], KeyL: ['p2', 'special'], KeyN: ['p2', 'block'],
};
const keyHeld = {};
window.addEventListener('keydown', (e) => {
  audio.init();
  if (e.code === 'KeyM') { const muted = audio.toggleMute(); showToast(muted ? '🔇 Son coupé' : '🔊 Son activé'); return; }
  const m = KEYMAP[e.code];
  if (!m) {
    if (e.code === 'KeyC' && mode === 'lobby') { gameMode = 'versus'; startSoloKeyboard(); return; }
    if (e.code === 'KeyB' && mode === 'lobby') { startSmashKeyboard(); return; }
    if (e.code === 'KeyT' && mode === 'lobby') { startStreetsKeyboard(); return; }
    if (e.code === 'Enter' && isEnded(active)) restartMatch();
    return;
  }
  if (soloMode && m[0] !== humanSlot) return;
  e.preventDefault();
  if (keyHeld[e.code]) return;
  keyHeld[e.code] = true;
  if (mode === 'lobby' && gameMode === 'versus') { forceKeyboardStart(); }
  if (isEnded(active) && m[1] === 'special') { restartMatch(); return; }
  active.setInput(m[0], m[1], true);
});
window.addEventListener('keyup', (e) => {
  const m = KEYMAP[e.code];
  if (!m) return;
  if (soloMode && m[0] !== humanSlot) return;
  keyHeld[e.code] = false;
  active.setInput(m[0], m[1], false);
});

let keyboardStarted = false;
function forceKeyboardStart() {
  if (keyboardStarted) return;
  keyboardStarted = true;
  selection.p1.connected = selection.p2.connected = true;
  startVersus();
}

// Solo versus au clavier : J1 = toi, J2 = CPU (touche C)
function startSoloKeyboard() {
  if (keyboardStarted) return;
  keyboardStarted = true;
  humanSlot = 'p1';
  soloMode = true;
  selection.p1.connected = true;
  selection.p2.charIdx = (selection.p1.charIdx + 1) % CHARACTER_LIST.length;
  active = versus; window.__engine = versus;
  audio.init();
  audio.startMusic('battle');
  mode = 'playing';
  paused = false;
  $('#lobby').classList.add('hidden');
  versus.configure(CHARACTER_LIST[selection.p1.charIdx].id, CHARACTER_LIST[selection.p2.charIdx].id);
  ais = [new AIController('p2', 'p1', 1)];
}

// Smash au clavier : J1 = toi (clavier), le reste = bots (touche B)
function startSmashKeyboard() {
  if (keyboardStarted) return;
  keyboardStarted = true;
  gameMode = 'smash';
  selection.p1.connected = true;
  const total = Math.min(4, 1 + Math.max(1, botsCount));
  const entries = [{ slot: 'p1', charId: CHARACTER_LIST[selection.p1.charIdx].id, cpu: false }];
  const botChars = ['darkmeregrand', 'darkpadre', 'padre'];
  for (let i = 1; i < total; i++) entries.push({ slot: SLOTS4[i], charId: botChars[(i - 1) % botChars.length], cpu: true });
  active = smash; window.__engine = smash;
  audio.init(); audio.startMusic('battle');
  smash.viewW = renderer.resize();
  mode = 'playing'; paused = false;
  $('#lobby').classList.add('hidden');
  smash.configure(entries);
  ais = entries.filter((e) => e.cpu).map((e) => new AIController(e.slot, null, 1));
}

// Streets au clavier : J1 = toi (clavier) + alliés CPU (touche T)
function startStreetsKeyboard() {
  if (keyboardStarted) return;
  keyboardStarted = true;
  gameMode = 'sor';
  selection.p1.connected = true;
  const total = Math.min(4, 1 + Math.max(1, alliesCount));
  const entries = [{ slot: 'p1', charId: CHARACTER_LIST[selection.p1.charIdx].id, cpu: false }];
  const allyChars = ['padre', 'meregrand', 'padre'];
  for (let i = 1; i < total; i++) entries.push({ slot: SLOTS4[i], charId: allyChars[(i - 1) % allyChars.length], cpu: true });
  active = streets; window.__engine = streets;
  audio.init(); audio.startMusic('battle');
  streets.viewW = renderer.resize();
  mode = 'playing'; paused = false;
  $('#lobby').classList.add('hidden');
  streets.configure(entries);
  ais = [];
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

startHost();
