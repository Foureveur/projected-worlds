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
const buttons = () => $$('#pad .btn');
const touchBtn = new Map(); // touchId -> data-btn

function btnUnder(x, y) {
  for (const el of buttons()) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}

function press(btn) {
  send({ t: 'input', btn, down: true });
  vibrate(6);
  const el = $(`#pad .btn[data-btn="${btn}"]`);
  if (el) el.classList.add('pressed');
}
function release(btn) {
  send({ t: 'input', btn, down: false });
  const el = $(`#pad .btn[data-btn="${btn}"]`);
  if (el) el.classList.remove('pressed');
}

function onTouchStart(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const el = btnUnder(t.clientX, t.clientY);
    if (el) {
      const btn = el.dataset.btn;
      touchBtn.set(t.identifier, btn);
      press(btn);
    }
  }
}
function onTouchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const prev = touchBtn.get(t.identifier) || null;
    const el = btnUnder(t.clientX, t.clientY);
    const now = el ? el.dataset.btn : null;
    if (prev !== now) {
      if (prev) release(prev);
      if (now) press(now);
      if (now) touchBtn.set(t.identifier, now);
      else touchBtn.delete(t.identifier);
    }
  }
}
function onTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const prev = touchBtn.get(t.identifier);
    if (prev) release(prev);
    touchBtn.delete(t.identifier);
  }
}

function bindPad() {
  const pad = $('#pad');
  pad.addEventListener('touchstart', onTouchStart, { passive: false });
  pad.addEventListener('touchmove', onTouchMove, { passive: false });
  pad.addEventListener('touchend', onTouchEnd, { passive: false });
  pad.addEventListener('touchcancel', onTouchEnd, { passive: false });

  // Souris (test sur PC)
  let mouseBtn = null;
  pad.addEventListener('mousedown', (e) => {
    const el = btnUnder(e.clientX, e.clientY);
    if (el) { mouseBtn = el.dataset.btn; press(mouseBtn); }
  });
  window.addEventListener('mouseup', () => { if (mouseBtn) { release(mouseBtn); mouseBtn = null; } });
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
