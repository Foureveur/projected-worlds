/**
 * controller.js — la manette qui tourne sur l'iPhone.
 *
 * Priorité : réactivité. Les appuis sont envoyés à l'instant précis du
 * touch (touchstart/touchend), pas à intervalle régulier. Le multitouch
 * est géré à la main (une même main peut tenir ▶ + 👊 en même temps, et
 * glisser du d-pad gauche vers droite).
 */

import * as Net from '../net/peernet.js';
import { CHARACTER_LIST } from '../game/characters.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const params = new URLSearchParams(location.search);
let room = (params.get('room') || '').toUpperCase();

let net = null;
let slot = null;
let selectedIdx = 0;
let isReady = false;
let started = false;

// ------------------------------------------------------------------
// Réseau (client peer-to-peer)
// ------------------------------------------------------------------
async function connectRoom(code) {
  room = code;
  setStatus('Connexion…');
  try {
    net = await Net.join(code, {
      onWelcome: (assigned) => { slot = assigned; goToSelect(); },
      onMessage: (msg) => onMessage(msg),
      onError: (reason) => {
        if (reason === 'no-room') { setStatus(''); showCodeEntry('Partie introuvable. Vérifie le code affiché sur l\'écran.'); }
        else if (reason === 'full') setStatus('La partie est déjà pleine (2 joueurs).');
        else setStatus('Connexion perdue… vérifie ta connexion et réessaie.');
      },
      onHostLeft: () => setStatus("L'écran s'est déconnecté…"),
    });
  } catch (e) {
    setStatus('Erreur de connexion');
  }
}

function send(obj) { if (net) net.send(obj); }

function onMessage(msg) {
  if (!msg) return;
  switch (msg.t) {
    case 'buzz': vibrate(msg.pattern); break;
    case 'state': updateHud(msg); break;
  }
}

// ------------------------------------------------------------------
// Écrans
// ------------------------------------------------------------------
function setStatus(txt) {
  const el = $('#connectStatus');
  if (el) el.textContent = txt;
}

function showCodeEntry(msg) {
  show('#connect');
  setStatus(msg || '');
  $('#codeEntry').classList.remove('hidden');
  $('#codeInput').focus();
}

function show(sel) {
  ['#connect', '#select', '#pad'].forEach((s) => $(s).classList.toggle('hidden', s !== sel));
  document.body.classList.toggle('in-game', sel === '#pad');
}

function goToSelect() {
  show('#select');
  selectChar(slot === 'p2' ? 1 : 0); // défaut : J1=Mémé, J2=Padre
}

function selectChar(idx) {
  selectedIdx = idx;
  $$('.char-pick').forEach((b) => b.classList.toggle('selected', Number(b.dataset.idx) === idx));
  send({ t: 'select', charIdx: idx });
  $('#readyBtn').classList.add('armed');
}

function doReady() {
  isReady = true;
  send({ t: 'ready', ready: true });
  show('#pad');
  $('#waiting').classList.remove('hidden');
  checkOrientation();
}

function doSolo() {
  send({ t: 'solo' });
  show('#pad');
  $('#waiting').textContent = 'Chargement du combat vs CPU…';
  $('#waiting').classList.remove('hidden');
  checkOrientation();
}

// Cartes de perso générées depuis la liste (2 originaux + 2 Dark)
function renderCharCards() {
  const grid = $('#charGrid');
  if (!grid) return;
  grid.innerHTML = '';
  CHARACTER_LIST.forEach((c, idx) => {
    const b = document.createElement('button');
    b.className = 'char-pick';
    b.dataset.idx = String(idx);
    b.innerHTML =
      `<div class="emoji">${c.emoji || '🥊'}</div>` +
      `<div class="cname">${c.name}</div>` +
      `<div class="cforms">${c.formNames.join(' › ')}</div>`;
    b.addEventListener('click', () => selectChar(idx));
    grid.appendChild(b);
  });
}

// ------------------------------------------------------------------
// HUD (état reçu de l'écran)
// ------------------------------------------------------------------
function updateHud(s) {
  started = true;
  $('#waiting').classList.add('hidden');
  $('#hudName').textContent = s.charName || '';
  $('#hudForm').textContent = s.formName || '';
  $('#hudSpecial').textContent = s.specialName || '';
  $('#hudHp').style.width = Math.max(0, s.health) + '%';
  const hp = $('#hudHp');
  hp.style.background = s.health < 30 ? 'var(--red)' : s.health < 60 ? 'var(--accent)' : 'var(--green)';
  $('#hudRage').style.width = s.rage + '%';
  const aura = ['#8a8a9a', '#ff5bd0', '#ff2b4a'];
  $('#hudRage').style.background = aura[s.form] || 'var(--pink)';
}

// ------------------------------------------------------------------
// Vibrations
// ------------------------------------------------------------------
function vibrate(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} }
}

// ------------------------------------------------------------------
// Entrées tactiles (multitouch maison)
// ------------------------------------------------------------------
// Mode de contrôle : 'dpad' (croix 3x3 + diagonales) ou 'joy' (joystick)
let ctrlMode = localStorage.getItem('ctrlMode') || 'dpad';
function applyMode() {
  document.body.classList.toggle('mode-dpad', ctrlMode === 'dpad');
  document.body.classList.toggle('mode-joy', ctrlMode === 'joy');
  $$('.mode-opt').forEach((b) => b.classList.toggle('active', b.dataset.mode === ctrlMode));
}
function setMode(m) {
  ctrlMode = m;
  try { localStorage.setItem('ctrlMode', m); } catch {}
  clearDirs(); joyReset(); clearDpadVisual();
  applyMode();
}

// --- Boutons d'action (droite) ---
function actUnder(x, y) {
  for (const el of $$('#pad .act')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}
function press(btn) {
  send({ t: 'input', btn, down: true });
  vibrate(6);
  const el = $(`#pad .act[data-btn="${btn}"]`);
  if (el) el.classList.add('pressed');
}
function release(btn) {
  send({ t: 'input', btn, down: false });
  const el = $(`#pad .act[data-btn="${btn}"]`);
  if (el) el.classList.remove('pressed');
}

// --- État directionnel (commun croix/joystick) ---
const dirState = { left: false, right: false, up: false, down: false };
function applyDirs(target) {
  for (const d of ['left', 'right', 'up', 'down']) {
    const want = !!target[d];
    if (dirState[d] !== want) { dirState[d] = want; send({ t: 'input', btn: d, down: want }); }
  }
}
function clearDirs() { applyDirs({}); }

// --- Croix 3x3 ---
function cellAt(x, y) {
  for (const el of $$('#dpad9 .dcell')) {
    if (el.classList.contains('center')) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}
function clearDpadVisual() { $$('#dpad9 .dcell').forEach((c) => c.classList.remove('pressed')); }
function setDpadCell(el) {
  clearDpadVisual();
  if (!el) { clearDirs(); return; }
  el.classList.add('pressed');
  const t = {};
  (el.dataset.dirs || '').split(' ').filter(Boolean).forEach((d) => { t[d] = true; });
  applyDirs(t);
}

// --- Joystick ---
function joyUpdate(x, y) {
  const base = $('#joystick').getBoundingClientRect();
  const cx = base.left + base.width / 2, cy = base.top + base.height / 2;
  let dx = x - cx, dy = y - cy;
  const max = base.width / 2, dist = Math.hypot(dx, dy) || 1;
  if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
  const k = $('#joyKnob'); if (k) k.style.transform = `translate(${dx}px, ${dy}px)`;
  const dz = max * 0.34;
  const t = {};
  if (dx < -dz) t.left = true; else if (dx > dz) t.right = true;
  if (dy < -dz) t.up = true; else if (dy > dz) t.down = true;
  applyDirs(t);
}
function joyReset() { const k = $('#joyKnob'); if (k) k.style.transform = 'translate(0,0)'; }

// --- Routage multitouch (action / croix / joystick) ---
const touchRole = new Map(); // id -> {type:'act',btn} | {type:'dpad'} | {type:'joy'}
let dpadTouch = null, joyTouch = null;
function inside(sel, x, y) {
  const el = $(sel); if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
function startTouch(id, x, y) {
  const a = actUnder(x, y);
  if (a) { touchRole.set(id, { type: 'act', btn: a.dataset.btn }); press(a.dataset.btn); return; }
  if (ctrlMode === 'joy' && joyTouch === null && inside('#joystick', x, y)) {
    joyTouch = id; touchRole.set(id, { type: 'joy' }); joyUpdate(x, y); return;
  }
  if (ctrlMode === 'dpad' && dpadTouch === null) {
    const c = cellAt(x, y);
    if (c) { dpadTouch = id; touchRole.set(id, { type: 'dpad' }); setDpadCell(c); }
  }
}
function moveTouch(id, x, y) {
  const role = touchRole.get(id);
  if (!role) { startTouch(id, x, y); return; }
  if (role.type === 'joy') joyUpdate(x, y);
  else if (role.type === 'dpad') setDpadCell(cellAt(x, y));
  else if (role.type === 'act') {
    const a = actUnder(x, y);
    const now = a ? a.dataset.btn : null;
    if (now !== role.btn) {
      release(role.btn);
      if (now) { press(now); role.btn = now; } else touchRole.delete(id);
    }
  }
}
function endTouch(id) {
  const role = touchRole.get(id);
  if (role) {
    if (role.type === 'joy') { joyTouch = null; joyReset(); clearDirs(); }
    else if (role.type === 'dpad') { dpadTouch = null; clearDpadVisual(); clearDirs(); }
    else if (role.type === 'act') release(role.btn);
  }
  touchRole.delete(id);
}

function bindPad() {
  const pad = $('#pad');
  pad.addEventListener('touchstart', (e) => { e.preventDefault(); for (const t of e.changedTouches) startTouch(t.identifier, t.clientX, t.clientY); }, { passive: false });
  pad.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) moveTouch(t.identifier, t.clientX, t.clientY); }, { passive: false });
  pad.addEventListener('touchend', (e) => { e.preventDefault(); for (const t of e.changedTouches) endTouch(t.identifier); }, { passive: false });
  pad.addEventListener('touchcancel', (e) => { e.preventDefault(); for (const t of e.changedTouches) endTouch(t.identifier); }, { passive: false });

  // Souris (test PC)
  pad.addEventListener('mousedown', (e) => startTouch('mouse', e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => { if (touchRole.has('mouse')) moveTouch('mouse', e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => endTouch('mouse'));
}

// ------------------------------------------------------------------
// Orientation
// ------------------------------------------------------------------
function checkOrientation() {
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  // On invite à tourner seulement pendant le jeu (menus OK en portrait).
  const inGame = !$('#pad').classList.contains('hidden');
  $('#rotate').classList.toggle('hidden', !(portrait && inGame));
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
renderCharCards();
$$('.mode-opt').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
applyMode();
$('#readyBtn').addEventListener('click', doReady);
$('#soloBtn').addEventListener('click', doSolo);
$('#codeBtn').addEventListener('click', () => {
  const code = $('#codeInput').value.trim().toUpperCase();
  if (code.length >= 3) { $('#codeEntry').classList.add('hidden'); connectRoom(code); }
});
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#codeBtn').click(); });

window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 200));
window.addEventListener('resize', checkOrientation);
// Empêche le zoom par double-tap
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

bindPad();
if (room) connectRoom(room);
else showCodeEntry();
