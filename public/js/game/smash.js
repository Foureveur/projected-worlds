/**
 * SmashEngine — mode « baston à 4 » (Super Smash-like).
 *
 * Free-for-all 2 à 4 combattants sur la même map (avec plateformes). Chacun
 * a un stock de vies : quand la santé tombe à 0 on perd une vie et on
 * réapparaît (invincible un court instant). Dernier debout = vainqueur.
 *
 * On réutilise tel quel la classe Fighter : il suffit d'exposer la même
 * interface que le moteur versus (onHit, onThrow, onKO, spawnProjectile,
 * platforms, camera, effects…). Le rendu et l'audio ne voient pas la
 * différence, ils itèrent sur `fighterList`.
 */

import { STAGE_W, GROUND_Y, STATE } from './constants.js';
import { Fighter } from './fighter.js';
import { getCharacter } from './characters.js';

const SLOTS = ['p1', 'p2', 'p3', 'p4'];
// Positions de départ / réapparition réparties sur la largeur du stage
const SPAWN_X = [0.18, 0.42, 0.58, 0.82].map((f) => STAGE_W * f);
const DEFAULT_STOCKS = 3;
const RESPAWN_FRAMES = 70;   // délai avant réapparition
const RESPAWN_INVULN = 110;  // invincibilité en réapparaissant (~1.8 s)

export class SmashEngine {
  constructor(hooks = {}) {
    this.hooks = Object.assign({ onEvent() {} }, hooks);
    this.mode = 'smash';
    this.fighters = { p1: null, p2: null, p3: null, p4: null };
    this.slots = [];          // slots réellement en jeu (ordre)
    this.projectiles = [];
    this.effects = [];
    this.combo = {};          // pas de compteur de combo en mêlée générale
    this.shake = 0;
    this.hitStop = 0;
    this.flash = 0;
    this.slowmo = 0;
    this._smSkip = false;
    this.phase = 'idle';
    this.phaseTimer = 0;
    this.announce = null;
    this.camera = { x: 0, zoom: 1 };
    this.winnerSlot = null;
    this.viewW = 640;
    this.stocksMax = DEFAULT_STOCKS;
    // Plateformes traversables (comme en versus) — un poil plus larges pour 4
    this.platforms = [
      { x: STAGE_W * 0.30, y: 214, w: 160 },
      { x: STAGE_W * 0.70, y: 214, w: 160 },
      { x: STAGE_W * 0.50, y: 158, w: 150 },
    ];
  }

  // entries : [{ slot, charId, cpu }]
  configure(entries, opts = {}) {
    this.stocksMax = opts.stocks || DEFAULT_STOCKS;
    this.fighters = { p1: null, p2: null, p3: null, p4: null };
    this.slots = [];
    entries.slice(0, 4).forEach((e, i) => {
      const x = SPAWN_X[i];
      const f = new Fighter(getCharacter(e.charId), e.slot, x, x < STAGE_W / 2 ? 1 : -1);
      f.stocks = this.stocksMax;
      f.eliminated = false;
      f.respawnTimer = 0;
      f.cpu = !!e.cpu;
      f._koCounted = false;
      f._spawnIndex = i;
      this.fighters[e.slot] = f;
      this.slots.push(e.slot);
    });
    this.projectiles = [];
    this.effects = [];
    this.winnerSlot = null;
    this._start();
  }

  _start() {
    this.phase = 'intro';
    this.phaseTimer = 90;
    this.announce = { text: 'SMASH !', sub: `${this.slots.length} COMBATTANTS`, timer: 90, big: true };
    this.hooks.onEvent('round-start', {});
  }

  rematch() {
    this.slots.forEach((slot, i) => {
      const f = this.fighters[slot];
      if (!f) return;
      const x = SPAWN_X[i];
      f.resetForRound(x, x < STAGE_W / 2 ? 1 : -1);
      f.stocks = this.stocksMax;
      f.eliminated = false;
      f.respawnTimer = 0;
      f._koCounted = false;
    });
    this.projectiles = [];
    this.effects = [];
    this.winnerSlot = null;
    this._start();
  }

  get fighterList() {
    return this.slots.map((s) => this.fighters[s]).filter(Boolean);
  }

  setInput(slot, btn, down) {
    const f = this.fighters[slot];
    if (f) f.setInput(btn, down);
  }

  // ------------------------------------------------------------------
  // Boucle fixe
  // ------------------------------------------------------------------
  update() {
    if (this.slowmo > 0) {
      this.slowmo--;
      this._smSkip = !this._smSkip;
      if (this._smSkip) { this._updateCamera(); return; }
    }
    if (this.shake > 0) this.shake *= 0.86;
    if (this.flash > 0) this.flash--;
    this._updateEffects();

    if (this.hitStop > 0) { this.hitStop--; this._updateCamera(); return; }

    const present = this.fighterList;
    if (!present.length) return;

    const active = this.phase === 'fight';

    for (const f of present) {
      const foe = this._nearestFoe(f);
      f.update(foe, this, active && !f.eliminated);
    }
    for (const f of present) if (f.landSquash === 8) this._spawnLandDust(f);

    if (active) {
      this._separateAll(present);
      for (const a of present) { if (!a.eliminated) this._resolveMelee(a, present); }
      this._updateProjectiles(present);
      for (const f of present) {
        if (f.respawnTimer > 0) { f.respawnTimer--; if (f.respawnTimer === 0) this._respawn(f); }
      }
    } else {
      this._updateProjectiles(present);
      this._advancePhase();
    }

    this._updateCamera();
  }

  _advancePhase() {
    if (this.announce && this.announce.timer > 0) this.announce.timer--;
    if (this.phaseTimer > 0) {
      this.phaseTimer--;
      if (this.phaseTimer === 0 && this.phase === 'intro') {
        this.phase = 'fight';
        this.announce = { text: 'GO !', sub: null, timer: 40, big: true };
        this.hooks.onEvent('fight', {});
      }
    }
  }

  _nearestFoe(f) {
    let best = null, bd = Infinity;
    for (const o of this.fighterList) {
      if (o === f || o.eliminated) continue;
      const d = Math.abs(o.pos.x - f.pos.x);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  _respawn(f) {
    const i = f._spawnIndex ?? 0;
    const x = SPAWN_X[i] ?? STAGE_W / 2;
    f.resetForRound(x, x < STAGE_W / 2 ? 1 : -1);
    f.pos.y = 120; f.onGround = false; f.vel.y = 0; f.state = STATE.JUMP;
    f.invuln = RESPAWN_INVULN;
    f._koCounted = false;
    this._spawnSpark(x, 120, 'block', '#ffffff', 10);
  }

  // ------------------------------------------------------------------
  // Collisions (mêlée générale : chaque attaque teste tous les autres)
  // ------------------------------------------------------------------
  _overlap(a, b) { return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t; }

  _resolveMelee(attacker, present) {
    const hb = attacker.getActiveHitbox();
    if (!hb) return;
    let hit = false;
    for (const d of present) {
      if (d === attacker || d.eliminated) continue;
      if (this._overlap(hb, d.getHurtbox())) {
        const res = d.takeHit(hb.move, attacker.pos.x, attacker, this);
        if (res !== 'ignore') hit = true;
      }
    }
    if (hit && attacker.attack) attacker.attack.hasHit = true;
  }

  _separateAll(present) {
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const p1 = present[i], p2 = present[j];
        if (p1.eliminated || p2.eliminated) continue;
        if (p1.state === STATE.KO || p2.state === STATE.KO) continue;
        this._separatePair(p1, p2);
      }
    }
  }

  _separatePair(p1, p2) {
    const a = p1.getHurtbox(), b = p2.getHurtbox();
    const vOverlap = a.t < b.b && a.b > b.t;
    if (!vOverlap) return;
    if (a.l < b.r && a.r > b.l) {
      const overlap = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const push = overlap / 2 + 0.1;
      if (p1.pos.x <= p2.pos.x) { p1.pos.x -= push; p2.pos.x += push; }
      else { p1.pos.x += push; p2.pos.x -= push; }
      p1._clampStage(); p2._clampStage();
    }
  }

  // ------------------------------------------------------------------
  // Projectiles
  // ------------------------------------------------------------------
  spawnProjectile(owner, move) {
    const s = owner.scale;
    const p = move.proj;
    this.projectiles.push({
      owner: owner.slot,
      move,
      x: owner.pos.x + owner.facing * 26 * s,
      y: owner.pos.y - 46 * s,
      vx: owner.facing * p.speed,
      facing: owner.facing,
      w: p.w * s, h: p.h * s,
      life: p.life,
      color: p.color, shape: p.shape,
      age: 0,
    });
    this.hooks.onEvent('special', { slot: owner.slot, shape: p.shape });
  }

  _updateProjectiles(present) {
    const fighting = this.phase === 'fight';
    for (const pr of this.projectiles) {
      pr.x += pr.vx; pr.age++; pr.life--;
      if (pr.x < -40 || pr.x > STAGE_W + 40) pr.life = 0;
      if (!fighting) continue;
      const box = { l: pr.x - pr.w / 2, r: pr.x + pr.w / 2, t: pr.y - pr.h / 2, b: pr.y + pr.h / 2 };
      for (const d of present) {
        if (d.slot === pr.owner || d.eliminated) continue;
        if (this._overlap(box, d.getHurtbox())) {
          const owner = this.fighters[pr.owner];
          const res = d.takeHit(pr.move, pr.x, owner, this);
          if (res !== 'ignore') { pr.life = 0; break; }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------------
  // Effets & caméra (repris du moteur versus)
  // ------------------------------------------------------------------
  _spawnSpark(x, y, kind, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (i % 2) * 0.4;
      const spd = 1.5 + (i % 3);
      this.effects.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 1, age: 0, life: 14 + (i % 6), kind, color, size: kind === 'heavy' ? 4 : 3 });
    }
  }

  _spawnSparkDir(x, y, dir, kind, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const spd = 2 + Math.random() * 3.5;
      this.effects.push({ x, y, vx: dir * spd + (Math.random() - 0.5) * 1.8, vy: (Math.random() - 0.72) * 3.2, age: 0, life: 12 + (i % 6), kind, color, size: kind === 'heavy' ? 4 : 3 });
    }
  }

  _spawnLandDust(f) {
    for (let i = 0; i < 5; i++) {
      const s = i / 4 - 0.5;
      this.effects.push({ x: f.pos.x + s * 16, y: f.pos.y - 2, vx: s * 2.4, vy: -0.6 - Math.random(), age: 0, life: 12 + (i % 4), kind: 'dust', color: '#cbb89a', size: 2 });
    }
  }

  _updateEffects() {
    for (const e of this.effects) {
      e.x += e.vx; e.y += e.vy;
      if (e.kind !== 'dust') e.vy += 0.25; else e.vy += 0.05;
      e.age++;
    }
    this.effects = this.effects.filter((e) => e.age < e.life);
  }

  _updateCamera() {
    const pts = this.fighterList.filter((f) => !f.eliminated);
    const list = pts.length ? pts : this.fighterList;
    if (!list.length) return;
    const margin = 150;
    const xs = list.map((f) => f.pos.x);
    const minX = Math.min(...xs) - margin;
    const maxX = Math.max(...xs) + margin;
    const span = Math.max(320, maxX - minX);
    let zoom = this.viewW / span;
    zoom = Math.max(0.6, Math.min(1.15, zoom));
    const mid = (minX + maxX) / 2;
    let camX = mid - (this.viewW / zoom) / 2;
    camX = Math.max(0, Math.min(STAGE_W - this.viewW / zoom, camX));
    this.camera.x += (camX - this.camera.x) * 0.16;
    this.camera.zoom += (zoom - this.camera.zoom) * 0.1;
  }

  // ------------------------------------------------------------------
  // Hooks appelés par les combattants
  // ------------------------------------------------------------------
  onAttackStart(fighter, kind) {
    if (kind !== 'light') this.hooks.onEvent('whiff', { slot: fighter.slot, kind });
  }

  onHit(defender, attacker, move, dmg, dir) {
    const cx = (defender.pos.x + (attacker ? attacker.pos.x : defender.pos.x)) / 2;
    const cy = defender.pos.y - defender.char.body.h * defender.scale * 0.55;
    const heavy = dmg >= 11;
    this._spawnSparkDir(cx, cy, dir, heavy ? 'heavy' : 'light', '#fff4b0', heavy ? 12 : 7);
    this.shake = Math.max(this.shake, heavy ? 10 : 5);
    this.hitStop = heavy ? 5 : 3;
    this.hooks.onEvent('hit', { slot: defender.slot, atk: attacker && attacker.slot, heavy, dmg });
  }

  onThrow(defender, attacker, dmg, dir) {
    const cy = defender.pos.y - defender.char.body.h * defender.scale * 0.5;
    this._spawnSpark(defender.pos.x, cy, 'heavy', '#ffd24a', 14);
    this.shake = Math.max(this.shake, 13);
    this.hitStop = 6;
    this.hooks.onEvent('throw', { slot: defender.slot, atk: attacker && attacker.slot, dmg });
  }

  onArmor(fighter, dir) {
    const cx = fighter.pos.x + dir * 10;
    const cy = fighter.pos.y - fighter.char.body.h * fighter.scale * 0.55;
    this._spawnSpark(cx, cy, 'block', '#ffd24a', 8);
    this.shake = Math.max(this.shake, 5);
    this.hitStop = 3;
    this.hooks.onEvent('armor', { slot: fighter.slot });
  }

  onDash(fighter, forward) {
    for (let i = 0; i < 4; i++) {
      this.effects.push({ x: fighter.pos.x - fighter.facing * (6 + i * 4), y: fighter.pos.y - 2, vx: -fighter.facing * (0.5 + i * 0.3), vy: -0.4, age: 0, life: 10 + i * 2, kind: 'dust', color: '#c9b89a', size: 2 });
    }
    this.hooks.onEvent('dash', { slot: fighter.slot, forward });
  }

  onBlock(defender, dir) {
    const cx = defender.pos.x + dir * 18;
    const cy = defender.pos.y - defender.char.body.h * defender.scale * 0.55;
    this._spawnSpark(cx, cy, 'block', '#8fd6ff', 6);
    this.shake = Math.max(this.shake, 3);
    this.hitStop = 2;
    this.hooks.onEvent('block', { slot: defender.slot });
  }

  onTransform(fighter) {
    this.shake = Math.max(this.shake, 12);
    this.flash = 8;
    this.hitStop = 4;
    const aura = fighter.char.formAura[fighter.formIndex] || '#ffffff';
    this._spawnSpark(fighter.pos.x, fighter.pos.y - 45, 'heavy', aura, 18);
    // Onde de choc : repousse les voisins proches
    for (const o of this.fighterList) {
      if (o === fighter || o.eliminated) continue;
      if (Math.abs(o.pos.x - fighter.pos.x) < 120) {
        const dir = o.pos.x >= fighter.pos.x ? 1 : -1;
        o.vel.x = dir * 8; o.vel.y = -5; o.onGround = false;
      }
    }
    this.announce = { text: fighter.char.formNames[fighter.formIndex].toUpperCase(), sub: 'RAGE !', timer: 60, big: false, slot: fighter.slot };
    this.hooks.onEvent('transform', { slot: fighter.slot, form: fighter.formIndex });
  }

  onKO(fighter) {
    this.shake = Math.max(this.shake, 18);
    this.hitStop = 8;
    this.flash = 8;
    this.slowmo = 32;
    this._spawnSpark(fighter.pos.x, fighter.pos.y - 40, 'heavy', '#ff5a5a', 18);
    if (fighter._koCounted) return;
    fighter._koCounted = true;
    fighter.stocks = Math.max(0, (fighter.stocks || 0) - 1);
    this.hooks.onEvent('ko', { slot: fighter.slot });
    if (fighter.stocks <= 0) {
      fighter.eliminated = true;
      this.announce = { text: `${fighter.char.name.toUpperCase()} ÉLIMINÉ !`, sub: null, timer: 80, big: false, slot: fighter.slot };
    } else {
      fighter.respawnTimer = RESPAWN_FRAMES;
    }
    this._checkWin();
  }

  _checkWin() {
    if (this.phase !== 'fight') return;
    const alive = this.fighterList.filter((f) => !f.eliminated);
    if (alive.length <= 1) this._matchEnd(alive[0] || null);
  }

  _matchEnd(winner) {
    this.phase = 'matchEnd';
    this.winnerSlot = winner ? winner.slot : null;
    this.shake = 18; this.flash = 10;
    this.announce = winner
      ? { text: `${winner.char.name.toUpperCase()} REMPORTE LE SMASH !`, sub: 'Dernier debout', timer: 999999, big: true }
      : { text: 'ÉGALITÉ !', sub: 'Tout le monde au tapis', timer: 999999, big: true };
    this.hooks.onEvent('match-end', { slot: winner ? winner.slot : null });
  }
}

// Couleurs d'identification par joueur (repris par le rendu / le HUD)
export const SLOT_COLORS = { p1: '#ff5bd0', p2: '#4ad6ff', p3: '#7ee081', p4: '#f5d90a' };
