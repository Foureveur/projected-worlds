/**
 * peernet.js — réseau peer-to-peer (WebRTC via PeerJS).
 *
 * Pourquoi P2P : le jeu devient un simple site statique (aucun serveur de
 * jeu à faire tourner) et les manettes parlent DIRECTEMENT à l'écran, ce
 * qui donne la latence la plus basse possible.
 *
 * Signalisation :
 *  - en ligne (Vercel) : serveur PeerJS public (net-config.json = "cloud")
 *  - en local (node server.js) : PeerServer intégré à même origine ("self")
 *
 * L'écran est "l'hôte" (peer d'ID connu = code de partie). Chaque manette
 * ouvre une connexion directe vers cet hôte.
 */

const NS = 'RAGEROYALE'; // préfixe pour limiter les collisions d'ID sur le cloud
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const hostId = (code) => `${NS}-${code}`;

function randCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

let cfgPromise = null;
function getConfig() {
  if (!cfgPromise) {
    cfgPromise = fetch('/net-config.json')
      .then((r) => r.json())
      .catch(() => ({ mode: 'cloud' }));
  }
  return cfgPromise;
}

function peerOptions(cfg) {
  if (cfg && cfg.mode === 'self') {
    const port = Number(location.port) || (location.protocol === 'https:' ? 443 : 80);
    return { host: location.hostname, port, path: '/peerjs', secure: location.protocol === 'https:' };
  }
  return {}; // serveur PeerJS public par défaut
}

/**
 * Démarre l'hôte (l'écran de jeu).
 * handlers: { onReady({roomCode, joinUrl}), onJoin(slot), onLeave(slot),
 *             onMessage(slot, msg), onError(err) }
 * Renvoie { send(slot,msg), broadcast(msg) }.
 */
export async function host(handlers) {
  const cfg = await getConfig();
  const opts = peerOptions(cfg);
  const conns = { p1: null, p2: null };
  let peer = null;

  function start(code, attempt) {
    peer = new Peer(hostId(code), opts);

    peer.on('open', () => {
      // On pointe vers un fichier réel (pas de dépendance à une réécriture /play)
      handlers.onReady({ roomCode: code, joinUrl: `${location.origin}/controller.html?room=${code}` });
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const slot = !conns.p1 ? 'p1' : !conns.p2 ? 'p2' : null;
        if (!slot) {
          conn.send({ t: 'error', reason: 'full', message: 'Partie pleine (2 joueurs).' });
          setTimeout(() => conn.close(), 150);
          return;
        }
        conns[slot] = conn;
        conn.send({ t: 'welcome', slot, room: code });
        handlers.onJoin && handlers.onJoin(slot);
        conn.on('data', (msg) => handlers.onMessage && handlers.onMessage(slot, msg));
        conn.on('close', () => {
          if (conns[slot] === conn) { conns[slot] = null; handlers.onLeave && handlers.onLeave(slot); }
        });
      });
    });

    peer.on('error', (err) => {
      if (err && err.type === 'unavailable-id' && attempt < 5) {
        try { peer.destroy(); } catch (e) {}
        start(randCode(), attempt + 1);
      } else if (err && err.type !== 'peer-unavailable') {
        handlers.onError && handlers.onError(err);
      }
    });
  }

  start(randCode(), 0);

  return {
    send(slot, msg) { const c = conns[slot]; if (c && c.open) c.send(msg); },
    broadcast(msg) { for (const s of ['p1', 'p2']) { const c = conns[s]; if (c && c.open) c.send(msg); } },
  };
}

/**
 * Rejoint une partie (une manette).
 * handlers: { onWelcome(slot, room), onMessage(msg), onError(reason), onHostLeft() }
 * Renvoie { send(msg) }.
 */
export async function join(code, handlers) {
  const cfg = await getConfig();
  const opts = peerOptions(cfg);
  const peer = new Peer(undefined, opts);
  let conn = null;

  peer.on('open', () => {
    conn = peer.connect(hostId(code), { reliable: true });
    conn.on('data', (msg) => {
      if (!msg) return;
      if (msg.t === 'welcome') handlers.onWelcome && handlers.onWelcome(msg.slot, msg.room);
      else if (msg.t === 'error') handlers.onError && handlers.onError(msg.reason || 'error');
      else handlers.onMessage && handlers.onMessage(msg);
    });
    conn.on('close', () => handlers.onHostLeft && handlers.onHostLeft());
    conn.on('error', () => handlers.onError && handlers.onError('conn'));
  });

  peer.on('error', (err) => {
    const type = err && err.type;
    if (type === 'peer-unavailable') handlers.onError && handlers.onError('no-room');
    else handlers.onError && handlers.onError(type || 'peer');
  });

  return {
    send(msg) { if (conn && conn.open) conn.send(msg); },
  };
}
