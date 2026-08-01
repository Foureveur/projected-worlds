/**
 * RAGE ROYALE — serveur de relais
 * ---------------------------------
 * Rôle unique : servir les fichiers statiques et relayer les messages
 * entre "l'écran de jeu" (le grand affichage) et les deux "manettes"
 * (les iPhones). Toute la simulation du jeu tourne sur l'écran ; le
 * serveur ne fait que transporter les appuis boutons le plus vite
 * possible. Sur un réseau local, ça donne une latence de quelques ms.
 *
 * Modèle de "room" :
 *   - Un écran crée une room -> le serveur génère un code à 4 lettres.
 *   - Chaque iPhone rejoint la room via ce code (scanné dans un QR code).
 *   - Le premier téléphone devient le joueur 1, le second le joueur 2.
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Petite redirection sympa : /play -> la manette
app.get('/play', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

// Génère un QR code PNG à la volée pour rejoindre une room depuis un iPhone.
app.get('/qr', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text) return res.status(400).send('missing text');
  try {
    res.type('png');
    const buf = await QRCode.toBuffer(text, {
      margin: 1,
      width: 320,
      color: { dark: '#1a1030', light: '#f5d90a' },
    });
    res.send(buf);
  } catch (err) {
    res.status(500).send('qr error');
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * rooms: Map<code, { screen: ws|null, players: { p1: ws|null, p2: ws|null } }>
 */
const rooms = new Map();

function makeRoomCode() {
  // Lettres sans ambiguïté (pas de I/O/0/1) pour une saisie facile.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

/** Trouve la première IPv4 non-interne (l'adresse LAN à donner aux iPhones). */
function getLanAddress() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  const empty =
    !room.screen && !room.players.p1 && !room.players.p2;
  if (empty) rooms.delete(code);
}

wss.on('connection', (ws) => {
  ws.meta = { role: null, room: null, slot: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // --- Établissement du rôle ---
    if (msg.t === 'hello') {
      if (msg.role === 'screen') {
        const code = makeRoomCode();
        rooms.set(code, { screen: ws, players: { p1: null, p2: null } });
        ws.meta = { role: 'screen', room: code, slot: null };
        const lan = getLanAddress();
        send(ws, {
          t: 'welcome',
          role: 'screen',
          room: code,
          joinUrl: `http://${lan}:${PORT}/play?room=${code}`,
          lan,
          port: PORT,
        });
        return;
      }

      if (msg.role === 'controller') {
        const code = (msg.room || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { t: 'error', reason: 'no-room', message: 'Room introuvable. Vérifie le code.' });
          return;
        }
        let slot = null;
        if (!room.players.p1) slot = 'p1';
        else if (!room.players.p2) slot = 'p2';
        if (!slot) {
          send(ws, { t: 'error', reason: 'full', message: 'La partie est déjà pleine (2 joueurs).' });
          return;
        }
        room.players[slot] = ws;
        ws.meta = { role: 'controller', room: code, slot };
        send(ws, { t: 'welcome', role: 'controller', slot, room: code });
        send(room.screen, { t: 'player-join', slot });
        return;
      }
      return;
    }

    // --- Relais des messages ---
    const room = rooms.get(ws.meta.room);
    if (!room) return;

    if (ws.meta.role === 'controller') {
      // Toujours vers l'écran, en taguant l'expéditeur.
      send(room.screen, { ...msg, from: ws.meta.slot });
    } else if (ws.meta.role === 'screen') {
      // L'écran peut cibler un joueur précis (msg.to = 'p1'|'p2'|'both').
      const to = msg.to || 'both';
      if (to === 'p1' || to === 'both') send(room.players.p1, msg);
      if (to === 'p2' || to === 'both') send(room.players.p2, msg);
    }
  });

  ws.on('close', () => {
    const { role, room: code, slot } = ws.meta;
    const room = rooms.get(code);
    if (!room) return;
    if (role === 'screen') {
      room.screen = null;
      // Prévenir les manettes que l'écran est parti.
      send(room.players.p1, { t: 'screen-left' });
      send(room.players.p2, { t: 'screen-left' });
    } else if (role === 'controller' && slot) {
      room.players[slot] = null;
      send(room.screen, { t: 'player-leave', slot });
    }
    cleanupRoom(code);
  });
});

server.listen(PORT, () => {
  const lan = getLanAddress();
  console.log('\n  ⚔️  RAGE ROYALE — Mère-Grand vs Padre');
  console.log('  ─────────────────────────────────────');
  console.log(`  🖥️  Écran de jeu  : http://localhost:${PORT}`);
  console.log(`  🖥️  (sur le LAN) : http://${lan}:${PORT}`);
  console.log(`  📱 Manettes     : ouvre l'écran, scanne le QR code\n`);
});
