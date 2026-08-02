/**
 * StreetsEngine — mode « Streets of Rage » (beat'em up co-op 2.5D).
 *
 * Déplacement en PROFONDEUR (z, haut/bas) + largeur (x) + saut dédié (y).
 * Le niveau défile, se verrouille sur des vagues d'ennemis, puis « GO → »,
 * et finit sur un boss. Co-op 1 à 4 (+ alliés CPU).
 *
 * Nouveautés :
 *  - Ennemis VARIÉS : Voyou / Rôdeuse / Molosse (armure) / Lanceuse (distance)
 *  - FUSION co-op : deux joueurs collés remplissent une jauge d'équipe et
 *    fusionnent en UN perso surpuissant — l'un PILOTE (déplacements),
 *    l'autre FRAPPE (attaques). Super attaque de zone incluse.
 *
 * Entités « maison » (BeatEntity) exposant les champs lus par le renderer
 * (char, pos, facing, state, attack, scale, hitFlash…) pour réutiliser le
 * dessin des personnages et des effets.
 */

import { GROUND_Y, STATE } from './constants.js';
import { getCharacter } from './characters.js';

// --- Plan de jeu ---
const ZMAX = 96;            // profondeur max (bas = proche, haut = loin)
const DEPTH_SCALE = 0.9;    // px verticaux par unité de profondeur
const GRAVITY = 0.7;
const JUMP_VEL = 11;
const WORLD_END = 2200;
const SLOT_COLORS = { p1: '#ff5bd0', p2: '#4ad6ff', p3: '#7ee081', p4: '#f5d90a' };

const REACH = { light: 48, heavy: 60, boss: 66 };
const Z_TOL = 26;
const Y_TOL = 46;

// --- Types d'ennemis ---------------------------------------------------------
// base = sprite réutilisé ; aura = couleur de glow ; comportement via flags.
const ENEMY_TYPES = {
  grunt:   { base: 'darkpadre',     label: 'Voyou',    hp: 44, spd: 1.0,  scale: 1.0,  dmg: 0.9,  aura: '#a02aff' },
  runner:  { base: 'darkmeregrand', label: 'Rôdeuse',  hp: 28, spd: 1.5,  scale: 0.9,  dmg: 0.7,  aura: '#4ad6ff', fast: true },
  brute:   { base: 'darkpadre',     label: 'Molosse',  hp: 78, spd: 0.62, scale: 1.4,  dmg: 1.1,  aura: '#ff3a2a', armor: true, heavyPref: true },
  thrower: { base: 'darkmeregrand', label: 'Lanceuse', hp: 32, spd: 0.9,  scale: 1.02, dmg: 0.8,  aura: '#7ee081', ranged: true },
};

// Clone superficiel d'un perso avec palette/aura retouchées (sans muter l'original)
function tintChar(base, opts = {}) {
  const c = Object.assign({}, base);
  if (opts.aura) c.formAura = [opts.aura, opts.aura, opts.aura];
  if (opts.palette) c.palette = Object.assign({}, base.palette, opts.palette);
  if (opts.name) c.name = opts.name;
  if (opts.short) c.short = opts.short;
  return c;
}

let _eid = 0;

class BeatEntity {
  constructor(charDef, opts = {}) {
    this.id = ++_eid;
    this.char = charDef;
    this.team = opts.team || 'enemy';
    this.slot = opts.slot || null;
    this.cpu = !!opts.cpu;
    this.isBoss = !!opts.isBoss;
    this.isFusion = !!opts.isFusion;
    this.baseScale = opts.scale || 1;
    this.type = opts.type || null;

    this.x = opts.x ?? 100;
    this.z = opts.z ?? ZMAX * 0.5;
    this.jumpY = 0; this.jumpVel = 0; this.onGround = true;
    this.facing = opts.facing ?? 1;

    this.maxHp = opts.hp || 100;
    this.hp = this.maxHp;
    this.lives = opts.lives ?? 0;
    this.dead = false;
    this.hidden = false;      // fusionné : caché/inactif
    this.spectator = false;   // joueur sans vie restante

    // Comportement (ennemis)
    this.spdMul = opts.spd || 1;
    this.dmgMul = opts.dmg || 1;
    this.armor = !!opts.armor;
    this.ranged = !!opts.ranged;
    this.heavyPref = !!opts.heavyPref;
    this.fast = !!opts.fast;

    // Fusion
    this.pilotSlot = null; this.gunnerSlot = null;
    this.fuseTimer = 0;
    this.fusionEntity = null; this.fusionRole = null;

    // Champs lus par le renderer
    this.pos = { x: this.x, y: GROUND_Y };
    this.vel = { x: 0, y: 0 };
    this.formIndex = opts.formIndex || 0;
    this.animTime = 0;
    this.state = STATE.IDLE;
    this.attack = null;
    this.hitFlash = 0; this.blockFlash = 0; this.landSquash = 0; this.tumbling = 0;
    this.armorActive = false;

    this.hitstun = 0;
    this.invuln = opts.invuln || 0;
    this.koTimer = 0;
    this.specialCd = 0;
    this.attackCd = 0;
    this.input = { left: false, right: false, up: false, down: false, jump: false, punch: false, kick: false, special: false };
    this.attackBuffer = null;
    this.jumpBuffer = 0;
  }

  get scale() { return this.baseScale; }
  get speed() { return (this.char.speed || 2.4) * (this.team === 'player' ? 1.05 : 0.82) * (this.isBoss ? 0.9 : 1) * this.spdMul; }

  setInput(btn, down) {
    if (this.input[btn] === down) return;
    this.input[btn] = down;
    if (!down) return;
    if (btn === 'jump') this.jumpBuffer = 6;
    else if (btn === 'punch') this.attackBuffer = { kind: 'light', frames: 6 };
    else if (btn === 'kick') this.attackBuffer = { kind: 'heavy', frames: 6 };
    else if (btn === 'special') this.attackBuffer = { kind: 'special', frames: 6 };
  }

  canAct() { return this.hitstun <= 0 && this.koTimer <= 0 && !this.dead && !this.attack; }
}

export class StreetsEngine {
  constructor(hooks = {}) {
    this.hooks = Object.assign({ onEvent() {} }, hooks);
    this.mode = 'streets';
    this.players = [];
    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.combo = {};
    this.shake = 0; this.hitStop = 0; this.flash = 0; this.slowmo = 0; this._smSkip = false;
    this.phase = 'idle';
    this.phaseTimer = 0;
    this.announce = null;
    this.camera = { x: 0, zoom: 1 };
    this.viewW = 640;
    this.worldEnd = WORLD_END;
    this.platforms = [];
    this.fusion = { gauge: 0, max: 100, active: null };

    this.gates = [
      { stopCamX: 340, spawn: makeWave(['grunt', 'runner', 'grunt', 'brute', 'runner']), max: 3, started: false, cleared: false },
      { stopCamX: 980, spawn: makeWave(['runner', 'grunt', 'thrower', 'brute', 'grunt']), max: 3, started: false, cleared: false },
      { stopCamX: 1560, spawn: [{ boss: true, charId: 'padre', hp: 210, scale: 1.28 }], max: 1, started: false, cleared: false, boss: true },
    ];
    this.gateIdx = 0;
    this.spawnTimer = 0;
  }

  configure(entries) {
    _eid = 0;
    this.players = entries.slice(0, 4).map((e, i) => new BeatEntity(getCharacter(e.charId), {
      team: 'player', slot: e.slot, cpu: !!e.cpu,
      x: 80 + i * 34, z: ZMAX * (0.35 + i * 0.12), facing: 1,
      hp: 130, lives: 3, invuln: 40,
    }));
    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.gateIdx = 0;
    this.fusion = { gauge: 0, max: 100, active: null };
    for (const g of this.gates) { g.started = false; g.cleared = false; g._t = 0; g._queue = g.spawn.slice(); }
    this.camera = { x: 0, zoom: 1 };
    this._start();
  }

  _start() {
    this.phase = 'intro';
    this.phaseTimer = 90;
    this.announce = { text: 'STREETS OF RAGE', sub: 'Nettoyez le quartier !', timer: 110, big: true };
    this.hooks.onEvent('round-start', {});
  }

  rematch() { this.configure(this._sourcePlayers().map((p) => ({ slot: p.slot, charId: p.char.id, cpu: p.cpu }))); }

  _sourcePlayers() { return this.players.filter((p) => !p.isFusion); }
  get fighterList() { return [...this.players.filter((p) => !p.hidden && !p.dead), ...this.enemies.filter((e) => !e.dead)]; }
  get fighters() { const o = {}; for (const p of this.players) if (p.slot) o[p.slot] = p; return o; }

  setInput(slot, btn, down) {
    const fu = this.fusion.active;
    if (fu) {
      if (slot === fu.pilotSlot) { if (['left', 'right', 'up', 'down', 'jump'].includes(btn)) fu.setInput(btn, down); return; }
      if (slot === fu.gunnerSlot) { if (['punch', 'kick', 'special'].includes(btn)) fu.setInput(btn, down); return; }
    }
    const p = this.players.find((e) => e.slot === slot && !e.isFusion);
    if (p) p.setInput(btn, down);
  }

  // ------------------------------------------------------------------
  update() {
    if (this.slowmo > 0) { this.slowmo--; this._smSkip = !this._smSkip; if (this._smSkip) { this._updateCamera(); return; } }
    if (this.shake > 0) this.shake *= 0.86;
    if (this.flash > 0) this.flash--;
    this._updateEffects();
    if (this.hitStop > 0) { this.hitStop--; this._updateCamera(); return; }

    if (this.phase === 'intro') {
      if (this.announce && this.announce.timer > 0) this.announce.timer--;
      if (this.phaseTimer > 0 && --this.phaseTimer === 0) { this.phase = 'play'; this.announce = { text: 'GO !', sub: null, timer: 40, big: true }; this.hooks.onEvent('fight', {}); }
      this._syncRender(); this._updateCamera(); return;
    }

    const playing = this.phase === 'play';
    const vw = this.viewW / this.camera.zoom;
    const gate = this.gates[this.gateIdx];
    const locked = gate && gate.started && !gate.cleared;
    const rightBarrier = locked ? this.camera.x + vw - 24 : this.worldEnd - 24;
    const leftBarrier = this.camera.x + 16;
    // Pendant une vague verrouillée, les ennemis restent DANS l'écran
    // (sinon une Lanceuse peut fuir hors de portée = blocage de la vague).
    const eLeft = locked ? this.camera.x + 12 : 20;
    const eRight = locked ? this.camera.x + vw - 12 : this.worldEnd - 20;

    // Anti-camping : le(s) dernier(s) ennemi(s) foncent (et une vague qui
    // traîne finit par rendre tout le monde agressif) — jamais de blocage.
    const living = this.enemies.filter((e) => !e.dead && e.koTimer <= 0).length;
    this._forceAggro = !!(gate && gate.started && !gate.cleared && gate._queue.length === 0 && (living <= 1 || (gate._t || 0) > 2400));

    for (const p of this.players) this._updatePlayer(p, playing, leftBarrier, rightBarrier);
    for (const e of this.enemies) this._updateEnemy(e, playing, eLeft, eRight);

    if (playing) {
      if (!this.fusion.active) this._tryFusion();
      this._separate();
      for (const a of [...this.players, ...this.enemies]) this._resolveAttack(a);
      this._updateProjectiles();
      this._manageWaves();
      this._checkState();
    }

    if (this.announce && this.announce.timer > 0) this.announce.timer--;
    this._syncRender();
    this._updateCamera();
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.players = this.players.filter((p) => !(p.isFusion && p._remove));
  }

  _alivePlayers() { return this.players.filter((p) => !p.dead && !p.hidden); }
  _activePlayers() { return this.players.filter((p) => !p.dead && !p.hidden && p.koTimer <= 0); }

  // ------------------------------------------------------------------
  // Joueurs (et entité de fusion, qui est un "player")
  // ------------------------------------------------------------------
  _updatePlayer(p, playing, leftBarrier, rightBarrier) {
    if (p.hidden) return;
    p.animTime++;
    if (p.hitFlash > 0) p.hitFlash--;
    if (p.landSquash > 0) p.landSquash--;
    if (p.invuln > 0) p.invuln--;
    if (p.specialCd > 0) p.specialCd--;
    if (p.attackBuffer && --p.attackBuffer.frames <= 0) p.attackBuffer = null;
    if (p.jumpBuffer > 0) p.jumpBuffer--;
    if (p.dead) return;

    // Fin de fusion (temps écoulé)
    if (p.isFusion) { if (p.fuseTimer > 0 && --p.fuseTimer === 0) { this._splitFusion(p, false); return; } }

    if (p.koTimer > 0) {
      p.koTimer--; p.state = STATE.KO; this._physics(p);
      if (p.koTimer === 0) {
        if (p.lives > 0) { p.lives--; this._respawnPlayer(p); }
        else { p.state = STATE.KO; p.hp = 0; p.spectator = true; }
      }
      return;
    }
    if (p.spectator) { this._physics(p); return; }

    if (p.hitstun > 0) { p.hitstun--; if (p.hitstun === 0 && p.state === STATE.HITSTUN) p.state = STATE.IDLE; }
    if (p.attack) this._advanceAttack(p);

    if (playing && p.cpu && p.canAct()) this._allyAI(p);

    if (p.canAct() && playing) {
      const inp = p.input;
      const mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const mz = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (mx || mz) {
        p.x += mx * p.speed; p.z += mz * p.speed * 0.8;
        if (mx) p.facing = mx > 0 ? 1 : -1;
        if (p.onGround) p.state = STATE.WALK;
      } else if (p.onGround) p.state = STATE.IDLE;
      if (p.jumpBuffer > 0 && p.onGround) { p.jumpVel = -JUMP_VEL; p.onGround = false; p.jumpBuffer = 0; p.state = STATE.JUMP; }
      if (p.attackBuffer) {
        const k = p.attackBuffer.kind; p.attackBuffer = null;
        // Auto-orientation : frapper sans pousser une direction vise l'ennemi le plus proche
        if (!inp.left && !inp.right) { const foe = this._nearestEnemy(p); if (foe) p.facing = foe.x >= p.x ? 1 : -1; }
        this._startAttack(p, k);
      }
    }

    p.z = Math.max(0, Math.min(ZMAX, p.z));
    p.x = Math.max(leftBarrier, Math.min(rightBarrier, p.x));
    this._physics(p);
  }

  _respawnPlayer(p) {
    p.hp = p.maxHp; p.koTimer = 0; p.state = STATE.IDLE; p.attack = null;
    p.x = this.camera.x + this.viewW / this.camera.zoom * 0.3;
    p.z = 6; p.jumpY = 0; p.onGround = false; p.jumpVel = -6;
    p.invuln = 90; p.spectator = false;
  }

  // ------------------------------------------------------------------
  // Fusion co-op
  // ------------------------------------------------------------------
  _tryFusion() {
    if (this.fusion.gauge < this.fusion.max) return;
    const avail = this._activePlayers().filter((p) => !p.isFusion);
    for (let i = 0; i < avail.length; i++) {
      for (let j = i + 1; j < avail.length; j++) {
        const a = avail[i], b = avail[j];
        if (!a.input.special || !b.input.special) continue;
        if (Math.abs(a.x - b.x) > 58) continue;
        if (Math.abs(a.z - b.z) > 30) continue;
        this._fuse(a, b); return;
      }
    }
  }

  _fuse(a, b) {
    // Pilote = slot le plus petit ; Frappeur = l'autre
    const order = ['p1', 'p2', 'p3', 'p4'];
    const pilot = order.indexOf(a.slot) <= order.indexOf(b.slot) ? a : b;
    const gunner = pilot === a ? b : a;

    const fusedChar = tintChar(getCharacter('padre'), {
      name: 'FUSION', short: 'FUSION',
      aura: '#ffd24a',
      palette: { skin: '#e8c07a', hair: '#f5d90a', cloth: '#f5d90a', cloth2: '#b8860b', accent: '#ff5bd0', weapon: '#7a5a10' },
    });
    const fused = new BeatEntity(fusedChar, {
      team: 'player', isFusion: true, scale: 1.44, hp: 220, formIndex: 2,
      x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, facing: pilot.facing,
    });
    fused.dmgMul = 1.5;
    fused.spdMul = 1.05;
    fused.pilotSlot = pilot.slot;
    fused.gunnerSlot = gunner.slot;
    fused.fuseTimer = 720; // ~12 s
    fused.jumpY = 0; fused.onGround = true;

    for (const src of [a, b]) { src.hidden = true; src.fusionEntity = fused; src.fusionRole = src === pilot ? 'pilote' : 'frappeur'; for (const k in src.input) src.input[k] = false; }
    this.players.push(fused);
    this.fusion.active = fused;
    this.fusion.gauge = 0;

    this.flash = 12; this.shake = 16; this.slowmo = 20;
    this._spark(fused.x, fused.z, 40, 'heavy', '#ffd24a', 24);
    this.announce = { text: 'FUSION !', sub: `${pilot.slot.toUpperCase()} pilote · ${gunner.slot.toUpperCase()} frappe`, timer: 80, big: true };
    this.hooks.onEvent('transform', { slot: pilot.slot, form: 2 });
  }

  _splitFusion(fused, penalty) {
    const pilot = this.players.find((p) => p.slot === fused.pilotSlot);
    const gunner = this.players.find((p) => p.slot === fused.gunnerSlot);
    const share = Math.max(24, Math.round(fused.hp / 2));
    [pilot, gunner].forEach((src, i) => {
      if (!src) return;
      src.hidden = false; src.fusionEntity = null; src.fusionRole = null;
      src.x = fused.x + (i === 0 ? -16 : 16); src.z = fused.z;
      src.jumpY = 0; src.onGround = true; src.state = STATE.IDLE; src.attack = null;
      if (penalty) { src.hp = 0; this._defeat(src, null); }
      else { src.hp = Math.min(src.maxHp, share); src.invuln = 60; }
    });
    fused._remove = true;
    this.fusion.active = null;
    this.shake = Math.max(this.shake, 8);
    this._spark(fused.x, fused.z, 40, 'block', '#ffd24a', 14);
    if (!penalty) this.announce = { text: 'DÉFUSION', sub: null, timer: 40, big: false };
  }

  // ------------------------------------------------------------------
  // Ennemis
  // ------------------------------------------------------------------
  _updateEnemy(e, playing, eLeft = 20, eRight = this.worldEnd - 20) {
    e.animTime++;
    if (e.hitFlash > 0) e.hitFlash--;
    if (e.landSquash > 0) e.landSquash--;
    if (e.invuln > 0) e.invuln--;
    if (e.attackCd > 0) e.attackCd--;
    if (e.specialCd > 0) e.specialCd--;
    if (e.dead) return;

    if (e.koTimer > 0) { e.koTimer--; e.state = STATE.KO; this._physics(e); if (e.koTimer === 0) e.dead = true; return; }
    if (e.hitstun > 0) { e.hitstun--; if (e.hitstun === 0 && e.state === STATE.HITSTUN) e.state = STATE.IDLE; }
    if (e.attack) this._advanceAttack(e);
    if (playing && e.canAct()) this._enemyAI(e);

    e.z = Math.max(0, Math.min(ZMAX, e.z));
    e.x = Math.max(eLeft, Math.min(eRight, e.x));
    this._physics(e);
  }

  _enemyAI(e) {
    const tgt = this._nearestPlayer(e);
    if (!tgt) { e.state = STATE.IDLE; return; }
    const dx = tgt.x - e.x, dz = tgt.z - e.z;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    e.facing = dx >= 0 ? 1 : -1;
    const sp = e.speed;

    // Lanceuse : garde ses distances et tire — sauf en mode agressif (dernier
    // ennemi / vague qui traîne) où elle fonce au corps-à-corps.
    if (e.ranged && !this._forceAggro) {
      if (adz > 6) e.z += Math.sign(dz) * sp * 0.7;
      if (adx < 130) { e.x -= Math.sign(dx) * sp; e.state = STATE.WALK; }      // recule
      else if (adx > 340) { e.x += Math.sign(dx) * sp; e.state = STATE.WALK; } // se rapproche à portée
      else if (e.specialCd <= 0 && adz <= Z_TOL) { this._startAttack(e, 'special'); e.specialCd = 90 + Math.floor(Math.random() * 40); }
      else e.state = STATE.IDLE;
      return;
    }

    const reach = (e.isBoss ? REACH.boss : REACH.light) * 0.9;
    if (adx <= reach + 6 && adz <= Z_TOL) {
      if (e.attackCd <= 0) {
        const kind = (e.heavyPref || e.isBoss) ? (Math.random() < 0.6 ? 'heavy' : 'light') : (Math.random() < 0.2 ? 'heavy' : 'light');
        this._startAttack(e, kind);
        e.attackCd = e.isBoss ? 54 : (e.fast ? 28 : 55) + Math.floor(Math.random() * 30);
      } else e.state = STATE.IDLE;
    } else {
      if (adx > reach) { e.x += Math.sign(dx) * sp; e.state = STATE.WALK; }
      if (adz > 4) e.z += Math.sign(dz) * sp * 0.7;
    }
  }

  _allyAI(p) {
    const tgt = this._nearestEnemy(p);
    if (!tgt) return;
    const dx = tgt.x - p.x, dz = tgt.z - p.z;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    p.facing = dx >= 0 ? 1 : -1;
    if (adx <= REACH.light && adz <= Z_TOL) {
      if (p.attackCd <= 0) { this._startAttack(p, Math.random() < 0.3 ? 'heavy' : 'light'); p.attackCd = 26; }
    } else {
      const sp = p.speed;
      if (adx > REACH.light - 8) p.x += Math.sign(dx) * sp;
      if (adz > 4) p.z += Math.sign(dz) * sp * 0.7;
      p.state = STATE.WALK;
    }
    if (p.attackCd > 0) p.attackCd--;
  }

  _nearestPlayer(e) {
    let best = null, bd = Infinity;
    for (const p of this._activePlayers()) { const d = Math.abs(p.x - e.x) + Math.abs(p.z - e.z) * 0.5; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  _nearestEnemy(p) {
    let best = null, bd = Infinity;
    for (const e of this.enemies) { if (e.dead || e.koTimer > 0) continue; const d = Math.abs(e.x - p.x) + Math.abs(e.z - p.z) * 0.5; if (d < bd) { bd = d; best = e; } }
    return best;
  }

  // ------------------------------------------------------------------
  // Attaques
  // ------------------------------------------------------------------
  _startAttack(ent, kind) {
    if (kind === 'special') {
      if (ent.specialCd > 0) return;
      // Fusion : super attaque de zone
      if (ent.isFusion) {
        ent.specialCd = 150; ent.state = STATE.ATTACK;
        ent.attack = { kind: 'special', move: ent.char.specials[2], phase: 'startup', timer: 8, hasHit: false, spawned: false, aoe: true, aerial: false, low: false, isThrow: false };
        return;
      }
      const move = ent.char.specials[0];
      ent.attack = { kind: 'special', move, phase: 'startup', timer: move.startup, hasHit: false, spawned: false, aerial: !ent.onGround, low: false, isThrow: false };
      ent.specialCd = 100; ent.state = STATE.ATTACK;
      return;
    }
    const move = kind === 'heavy' ? ent.char.heavy : ent.char.light;
    ent.attack = { kind, move, phase: 'startup', timer: move.startup, hasHit: false, spawned: false, aerial: !ent.onGround, low: false, isThrow: false };
    ent.state = STATE.ATTACK;
  }

  _advanceAttack(ent) {
    const a = ent.attack;
    a.timer--;
    if (a.timer > 0) return;
    if (a.phase === 'startup') {
      a.phase = 'active'; a.timer = a.move.active || 3;
      if (a.aoe) this._fusionBlast(ent);
      else if (a.kind === 'special' && !a.spawned) { a.spawned = true; this._spawnProjectile(ent, a.move); }
    } else if (a.phase === 'active') {
      a.phase = 'recovery'; a.timer = a.move.recovery;
    } else { ent.attack = null; ent.state = STATE.IDLE; }
  }

  _fusionBlast(ent) {
    const R = 170;
    this.flash = 10; this.shake = 16; this.slowmo = 12;
    this._spark(ent.x, ent.z, 30, 'heavy', '#ffd24a', 26);
    const move = { dmg: 26, hitstun: 30, kb: { x: 11, y: 0 }, kind: 'heavy' };
    for (const e of this.enemies) {
      if (e.dead || e.koTimer > 0) continue;
      if (Math.abs(e.x - ent.x) > R) continue;
      if (Math.abs(e.z - ent.z) > 44) continue;
      this._hit(ent, e, move);
    }
    this.hooks.onEvent('special', { slot: ent.pilotSlot, shape: 'fire' });
  }

  _resolveAttack(att) {
    const a = att.attack;
    if (!a || a.phase !== 'active' || a.hasHit || a.kind === 'special') return;
    const reach = (att.isBoss ? REACH.boss : REACH[a.kind] || REACH.light) * att.scale;
    const targets = att.team === 'player' ? this.enemies : this.players;
    let hit = false;
    for (const d of targets) {
      if (d.dead || d.hidden || d.koTimer > 0 || d.invuln > 0) continue;
      const dx = (d.x - att.x) * att.facing;
      if (dx < -8 || dx > reach) continue;
      if (Math.abs(d.z - att.z) > Z_TOL) continue;
      if (Math.abs(d.jumpY - att.jumpY) > Y_TOL) continue;
      this._hit(att, d, a.move); hit = true;
    }
    if (hit) a.hasHit = true;
  }

  _hit(att, def, move) {
    const dmg = Math.round((move.dmg) * (att.isBoss ? 1.2 : (att.dmgMul || 1)));
    def.hp = Math.max(0, def.hp - dmg);
    def.hitFlash = 6;
    const heavy = dmg >= 11 || move.kind === 'heavy';
    // Armure (Molosse) : les petits coups font mal mais ne sonnent pas
    const staggers = !(def.armor && !heavy);
    if (staggers) {
      def.hitstun = move.hitstun; def.state = STATE.HITSTUN;
      const dir = att.facing; def.vel.x = dir * (move.kb.x || 4); def.x += dir * 3;
    } else {
      def.hitFlash = 3;
    }
    const cx = (att.x + def.x) / 2;
    this._spark(cx, def.z, def.jumpY, heavy ? 'heavy' : 'light', staggers ? '#fff4b0' : '#cfd6e6', heavy ? 12 : 7);
    this.shake = Math.max(this.shake, heavy ? 9 : 5);
    this.hitStop = heavy ? 5 : 3;
    // Jauge de fusion : monte quand un joueur touche un ennemi
    if (att.team === 'player' && def.team === 'enemy' && !this.fusion.active) {
      this.fusion.gauge = Math.min(this.fusion.max, this.fusion.gauge + (heavy ? 4 : 2.5));
    }
    this.hooks.onEvent('hit', { slot: def.slot || att.slot, atk: att.slot || att.pilotSlot, heavy, dmg });
    if (def.hp <= 0) this._defeat(def, att);
  }

  _defeat(ent, by) {
    if (ent.isFusion) { this._splitFusion(ent, true); return; }
    ent.state = STATE.KO; ent.attack = null; ent.hitstun = 0;
    ent.vel.x = (by ? by.facing : 1) * 6; ent.jumpVel = -7; ent.onGround = false;
    this.shake = Math.max(this.shake, 12); this.flash = 6;
    this._spark(ent.x, ent.z, ent.jumpY + 30, 'heavy', '#ff5a5a', 16);
    this.hooks.onEvent('ko', { slot: ent.slot });
    if (ent.team === 'enemy') {
      ent.koTimer = 26;
      if (by && by.team === 'player' && !this.fusion.active) this.fusion.gauge = Math.min(this.fusion.max, this.fusion.gauge + 12);
    } else ent.koTimer = 60;
  }

  // ------------------------------------------------------------------
  // Projectiles
  // ------------------------------------------------------------------
  _spawnProjectile(owner, move) {
    const p = move.proj; const s = owner.scale;
    this.projectiles.push({
      ownerId: owner.id, team: owner.team, move,
      x: owner.x + owner.facing * 26 * s, z: owner.z, jumpY: owner.jumpY + 46,
      vx: owner.facing * p.speed, facing: owner.facing,
      w: p.w * s, h: p.h * s, life: p.life, color: p.color, shape: p.shape, age: 0, y: GROUND_Y,
    });
    this.hooks.onEvent('special', { slot: owner.slot, shape: p.shape });
  }

  _updateProjectiles() {
    for (const pr of this.projectiles) {
      pr.x += pr.vx; pr.age++; pr.life--;
      if (pr.x < this.camera.x - 60 || pr.x > this.camera.x + this.viewW / this.camera.zoom + 60) pr.life = 0;
      const targets = pr.team === 'player' ? this.enemies : this.players;
      for (const d of targets) {
        if (d.dead || d.hidden || d.koTimer > 0 || d.invuln > 0) continue;
        if (Math.abs(d.x - pr.x) > pr.w / 2 + 22) continue;
        if (Math.abs(d.z - pr.z) > Z_TOL) continue;
        const owner = [...this.players, ...this.enemies].find((e) => e.id === pr.ownerId);
        this._hit(owner || { facing: pr.facing, isBoss: false, slot: null, team: pr.team, dmgMul: 1 }, d, pr.move);
        pr.life = 0; break;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------------
  // Vagues / progression
  // ------------------------------------------------------------------
  _manageWaves() {
    const gate = this.gates[this.gateIdx];
    if (!gate) return;
    if (!gate.started) {
      if (this.camera.x >= gate.stopCamX - 4) {
        gate.started = true; this.spawnTimer = 0;
        this.announce = gate.boss
          ? { text: 'BOSS', sub: 'El Padre Furioso', timer: 80, big: true }
          : { text: 'ATTENTION !', sub: 'Ennemis en approche', timer: 60, big: false };
      }
      return;
    }
    if (gate.cleared) return;
    gate._t = (gate._t || 0) + 1;
    if (this.spawnTimer > 0) this.spawnTimer--;
    const living = this.enemies.filter((e) => !e.dead).length;
    if (gate._queue.length && living < gate.max && this.spawnTimer <= 0) { this._spawnEnemy(gate._queue.shift()); this.spawnTimer = 40; }
    if (gate._queue.length === 0 && this.enemies.filter((e) => !e.dead).length === 0) {
      gate.cleared = true;
      if (gate.boss) { this._clear(); return; }
      this.announce = { text: 'GO →', sub: null, timer: 70, big: true };
      this.gateIdx++;
    }
  }

  _spawnEnemy(spec) {
    const fromRight = Math.random() < 0.7;
    const vw = this.viewW / this.camera.zoom;
    const x = fromRight ? this.camera.x + vw - 30 - Math.random() * 40 : this.camera.x + 30 + Math.random() * 40;
    const z = 12 + Math.random() * (ZMAX - 20);
    if (spec.boss) {
      const e = new BeatEntity(getCharacter(spec.charId), { team: 'enemy', x, z, facing: -1, hp: spec.hp, scale: spec.scale, isBoss: true, invuln: 12, heavyPref: true, dmg: 1, spd: 1 });
      e.formIndex = 2; this.enemies.push(e); return;
    }
    const t = ENEMY_TYPES[spec.type] || ENEMY_TYPES.grunt;
    const char = tintChar(getCharacter(t.base), { aura: t.aura });
    const e = new BeatEntity(char, {
      team: 'enemy', type: spec.type, x, z, facing: fromRight ? -1 : 1,
      hp: t.hp, scale: t.scale, invuln: 12,
      spd: t.spd, dmg: t.dmg, armor: t.armor, ranged: t.ranged, heavyPref: t.heavyPref, fast: t.fast,
    });
    if (t.aura) e.formIndex = 0;
    this.enemies.push(e);
  }

  _checkState() {
    if (this.phase !== 'play') return;
    const anyLive = this.players.some((p) => !p.hidden && !p.spectator && p.koTimer <= 0 && p.hp > 0);
    const anyLivesLeft = this._sourcePlayers().some((p) => p.lives > 0 && !p.spectator);
    if (!anyLive && !anyLivesLeft) this._gameOver();
  }

  _clear() {
    this.phase = 'clear'; this.flash = 12; this.shake = 16;
    this.announce = { text: 'NIVEAU TERMINÉ !', sub: 'Le quartier est sauvé', timer: 999999, big: true };
    this.hooks.onEvent('match-end', { slot: this._alivePlayers()[0] && this._alivePlayers()[0].slot });
  }
  _gameOver() {
    this.phase = 'gameover'; this.shake = 14;
    this.announce = { text: 'GAME OVER', sub: 'Appuie sur ⚡ pour recommencer', timer: 999999, big: true };
    this.hooks.onEvent('match-end', { slot: null });
  }

  // ------------------------------------------------------------------
  // Physique + séparation
  // ------------------------------------------------------------------
  _physics(ent) {
    if (!ent.onGround || ent.jumpVel < 0) {
      ent.jumpVel += GRAVITY; ent.jumpY -= ent.jumpVel;
      if (ent.jumpY <= 0) { ent.jumpY = 0; ent.jumpVel = 0; if (!ent.onGround) { ent.onGround = true; ent.landSquash = 8; if (ent.state === STATE.JUMP) ent.state = STATE.IDLE; } }
    }
    if (Math.abs(ent.vel.x) > 0.05) { ent.x += ent.vel.x; ent.vel.x *= 0.8; } else ent.vel.x = 0;
    ent.vel.y = -ent.jumpVel;
  }

  _separate() {
    const all = [...this.players, ...this.enemies].filter((e) => !e.dead && !e.hidden && e.koTimer <= 0);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (Math.abs(a.z - b.z) > 20) continue;
        if (Math.abs(a.jumpY - b.jumpY) > 40) continue;
        const dx = b.x - a.x; const min = 26 * ((a.scale + b.scale) / 2);
        if (Math.abs(dx) < min) { const push = (min - Math.abs(dx)) / 2 + 0.1; const s = dx >= 0 ? 1 : -1; a.x -= s * push; b.x += s * push; }
      }
    }
  }

  _syncRender() {
    for (const e of [...this.players, ...this.enemies]) { e.pos.x = e.x; e.pos.y = GROUND_Y - e.z * DEPTH_SCALE - e.jumpY; e.onGround = e.jumpY <= 0; }
    for (const pr of this.projectiles) pr.y = GROUND_Y - pr.z * DEPTH_SCALE - 0;
  }

  _spark(x, z, jumpY, kind, color, count = 8) {
    const y = GROUND_Y - z * DEPTH_SCALE - jumpY;
    for (let i = 0; i < count; i++) {
      const spd = 2 + Math.random() * 3.2; const ang = (Math.PI * 2 * i) / count;
      this.effects.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 1.2, age: 0, life: 12 + (i % 6), kind, color, size: kind === 'heavy' ? 4 : 3 });
    }
  }
  _updateEffects() { for (const e of this.effects) { e.x += e.vx; e.y += e.vy; e.vy += 0.25; e.age++; } this.effects = this.effects.filter((e) => e.age < e.life); }

  _updateCamera() {
    const ps = this._activePlayers();
    const ref = ps.length ? ps : this._alivePlayers();
    if (!ref.length) return;
    const vw = this.viewW / this.camera.zoom;
    const avg = ref.reduce((s, p) => s + p.x, 0) / ref.length;
    let target = avg - vw * 0.45;
    const gate = this.gates[this.gateIdx];
    const locked = gate && gate.started && !gate.cleared;
    const maxCam = locked ? gate.stopCamX : this.worldEnd - vw;
    target = Math.max(0, Math.min(maxCam, target));
    if (gate && !gate.started) target = Math.min(target, gate.stopCamX);
    this.camera.x += (target - this.camera.x) * 0.12;
  }

  get hud() {
    const fused = this.fusion.active;
    return {
      players: this._sourcePlayers().map((p) => ({
        slot: p.slot, name: p.char.short || p.char.name, hp: p.hp, maxHp: p.maxHp, lives: p.lives,
        dead: p.spectator, color: SLOT_COLORS[p.slot], fused: !!p.hidden, role: p.fusionRole,
      })),
      enemies: this.enemies.filter((e) => !e.dead).length,
      queue: (this.gates[this.gateIdx] && this.gates[this.gateIdx]._queue ? this.gates[this.gateIdx]._queue.length : 0),
      boss: this.enemies.find((e) => e.isBoss && !e.dead) || null,
      fusion: { gauge: this.fusion.gauge, max: this.fusion.max, active: !!fused, hp: fused ? fused.hp : 0, maxHp: fused ? fused.maxHp : 0, timer: fused ? fused.fuseTimer : 0, entity: fused || null },
      progress: Math.min(1, this.camera.x / (this.worldEnd - this.viewW)),
    };
  }
}

function makeWave(types) { return types.map((t) => ({ type: t })); }

export { SLOT_COLORS as STREETS_COLORS, ZMAX, DEPTH_SCALE };
