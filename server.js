/**
 * RAGE ROYALE — serveur de développement local.
 *
 * En production, le jeu est un SITE STATIQUE : les manettes parlent
 * directement à l'écran en peer-to-peer (WebRTC/PeerJS), donc aucun
 * serveur de jeu n'est nécessaire — il est hébergé tel quel (ex: Vercel).
 *
 * Ce petit serveur sert seulement à jouer/tester en LOCAL sans dépendre
 * d'internet : il sert les fichiers statiques ET embarque un PeerServer
 * (signalisation WebRTC) à même origine. Le client choisit la
 * signalisation via /net-config.json (voici "self", en ligne "cloud").
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ExpressPeerServer } from 'peer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

// En local : signalisation PeerJS à même origine.
app.get('/net-config.json', (_req, res) => res.json({ mode: 'self' }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// PeerServer intégré (signalisation WebRTC) monté sur /peerjs
const peerServer = ExpressPeerServer(server, { path: '/' });
app.use('/peerjs', peerServer);

function getLanAddress() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, HOST, () => {
  const lan = getLanAddress();
  console.log('\n  ⚔️  RAGE ROYALE — Mère-Grand vs Padre (local)');
  console.log('  ─────────────────────────────────────');
  console.log(`  🖥️  Écran de jeu  : http://localhost:${PORT}`);
  console.log(`  🖥️  (sur le LAN) : http://${lan}:${PORT}`);
  console.log(`  📱 Manettes     : ouvre l'écran, scanne le QR code\n`);
});
