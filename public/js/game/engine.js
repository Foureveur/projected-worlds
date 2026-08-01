/**
 * Engine — orchestre le combat.
 *
 * Responsabilités :
 *  - faire avancer les deux combattants à pas fixe
 *  - résoudre les collisions (corps-à-corps, projectiles, corps des persos)
 *  - gérer les phases : intro -> fight -> roundEnd -> (intro | matchEnd)
 *  - caméra dynamique qui cadre les deux combattants
 *  - effets : étincelles, secousses d'écran
 *  - émettre des événements (son, vibration des manettes) via `hooks`
 */

import {
  VIEW_W, VIEW_H, STAGE_W, GROUND_Y, ROUND_TIME, ROUNDS_TO_WIN, STATE,
} from './constants.js';
import { Fighter } from './fighter.js';
import { getCharacter } from './characters.js';

const SPAWN = { p1: STAGE_W * 0.34, p2: STAGE_W * 0.66 };

export class Engine {
  constructor(hooks = {}) {
    this.hooks = Object.assign(
      { onEvent() {}, },
      hooks
    );
    this.fighters = { p1: null, p2: null };
    this.projectiles = [];
    this.effects = [];
    this.shake = 0;
    this.hitStop = 0; // gel très bref à l'impact (le fameux "juice")
    this.phase = 'idle';
    this.phaseTimer = 0;
    this.roundTimer = ROUND_TIME * 60;
    this.round = 1;
    this.roundsToWin = ROUNDS_TO_WIN; // configurable (nb de manches gagnantes)
    this.viewW = VIEW_W;              // largeur d'affichage (dynamique, pour la caméra)
    // Plateformes traversables (sens unique) — sauter dessus, ↓ pour redescendre
    this.platforms = [
      { x: STAGE_W * 0.28, y: 214, w: 150 },
      { x: STAGE_W * 0.72, y: 214, w: 150 },
    ];
    this.announce = null; // { text, sub, timer, big }
    this.camera = { x: 0, zoom: 1 };
    this.winnerSlot = null;
    this.flash = 0;
    this.slowmo = 0;      // ralenti dramatique (KO)
    this._smSkip = false;
    // Compteur de combos par attaquant
    this.combo = { p1: { count: 0, timer: 0 }, p2: { count: 0, timer: 0 } };
  }

  configure(charP1Id, charP2Id) {
    this.fighters.p1 = new Fighter(getCharacter(charP1Id), 'p1', SPAWN.p1, 1);
    this.fighters.p2 = new Fighter(getCharacter(charP2Id), 'p2', SPAWN.p2, -1);
    this.projectiles = [];
    this.effects = [];
    this.round = 1;
    this.fighters.p1.wins = 0;
    this.fighters.p2.wins = 0;
    this._startRound();
  }

  _startRound() {
    this.fighters.p1.resetForRound(SPAWN.p1, 1);
    this.fighters.p2.resetForRound(SPAWN.p2, -1);
    this.projectiles = [];
    this.roundTimer = ROUND_TIME * 60;
    this.phase = 'intro';
    this.phaseTimer = 100;
    this.winnerSlot = null;
    this.announce = { text: `ROUND ${this.round}`, sub: null, timer: 100, big: true };
    this.hooks.onEvent('round-start', { round: this.round });
  }

  setInput(slot, btn, down) {
    const f = this.fighters[slot];
    if (f) f.setInput(btn, down);
  }

  // ------------------------------------------------------------------
  // Boucle fixe
  // ------------------------------------------------------------------
  update() {
    // Ralenti : on saute une frame de sim sur deux (mi-vitesse)
    if (this.slowmo > 0) {
      this.slowmo--;
      this._smSkip = !this._smSkip;
      if (this._smSkip) { this._updateCamera(); return; }
    }
    if (this.shake > 0) this.shake *= 0.86;
    if (this.flash > 0) this.flash--;
    this._updateCombos();
    this._updateEffects();

    // Hit-stop : on gèle tout brièvement pour donner du poids aux impacts.
    if (this.hitStop > 0) { this.hitStop--; this._updateCamera(); return; }

    const p1 = this.fighters.p1, p2 = this.fighters.p2;
    if (!p1 || !p2) return;

    const active = this.phase === 'fight';

    p1.update(p2, this, active);
    p2.update(p1, this, active);

    // Poussière à la réception d'un saut
    if (p1.landSquash === 8) this._spawnLandDust(p1);
    if (p2.landSquash === 8) this._spawnLandDust(p2);

    if (active) {
      this._separateBodies(p1, p2);
      this._resolveMelee(p1, p2);
      this._resolveMelee(p2, p1);
      this._updateProjectiles();

      // Chrono
      this.roundTimer--;
      if (this.roundTimer <= 0) this._endRoundByTime();

      if (p1.state === STATE.KO || p2.state === STATE.KO) this._endRound();
    } else {
      this._updateProjectiles();
      this._advancePhase();
    }

    this._updateCamera();
  }

  _advancePhase() {
    if (this.announce && this.announce.timer > 0) this.announce.timer--;
    if (this.phaseTimer > 0) {
      this.phaseTimer--;
      if (this.phaseTimer === 0) {
        if (this.phase === 'intro') {
          this.phase = 'fight';
          this.announce = { text: 'FIGHT!', sub: null, timer: 45, big: true };
          this.hooks.onEvent('fight', {});
        } else if (this.phase === 'roundEnd') {
          const p1 = this.fighters.p1, p2 = this.fighters.p2;
          if (p1.wins >= this.roundsToWin || p2.wins >= this.roundsToWin) {
            this._startMatchEnd();
          } else {
            this.round++;
            this._startRound();
          }
        }
      }
    }
  }

  _endRound() {
    if (this.phase !== 'fight') return;
    const p1 = this.fighters.p1, p2 = this.fighters.p2;
    let winner = null;
    if (p1.state === STATE.KO && p2.state === STATE.KO) winner = null;
    else if (p1.state === STATE.KO) winner = p2;
    else if (p2.state === STATE.KO) winner = p1;
    this._finishRound(winner);
  }

  _endRoundByTime() {
    const p1 = this.fighters.p1, p2 = this.fighters.p2;
    let winner = null;
    if (p1.health > p2.health) winner = p1;
    else if (p2.health > p1.health) winner = p2;
    this._finishRound(winner, true);
  }

  _finishRound(winner, byTime = false) {
    this.phase = 'roundEnd';
    this.phaseTimer = 150;
    this.shake = Math.max(this.shake, 14);
    this.flash = 6;
    if (winner) {
      winner.wins++;
      this.announce = { text: `${winner.char.name.toUpperCase()} gagne le round !`, sub: byTime ? 'Temps écoulé' : 'K.O.', timer: 150, big: false };
      this.hooks.onEvent('ko', { slot: winner.slot });
    } else {
      this.announce = { text: 'DOUBLE K.O. !', sub: 'Égalité', timer: 150, big: false };
      this.hooks.onEvent('ko', {});
    }
  }

  _startMatchEnd() {
    const p1 = this.fighters.p1, p2 = this.fighters.p2;
    const champ = p1.wins > p2.wins ? p1 : p2;
    this.winnerSlot = champ.slot;
    this.phase = 'matchEnd';
    this.announce = {
      text: `${champ.char.name.toUpperCase()} REMPORTE LE COMBAT !`,
      sub: `${champ.char.formNames[champ.formIndex]}`,
      timer: 999999, big: true,
    };
    this.shake = 18;
    this.flash = 10;
    this.hooks.onEvent('match-end', { slot: champ.slot, char: champ.char.id });
  }

  rematch() {
    const p1 = this.fighters.p1, p2 = this.fighters.p2;
    if (!p1 || !p2) return;
    this.round = 1;
    p1.wins = 0; p2.wins = 0;
    this._startRound();
  }

  // ------------------------------------------------------------------
  // Collisions
  // ------------------------------------------------------------------
  _overlap(a, b) {
    return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  }

  _resolveMelee(attacker, defender) {
    const hb = attacker.getActiveHitbox();
    if (!hb) return;
    const hurt = defender.getHurtbox();
    if (this._overlap(hb, hurt)) {
      const res = defender.takeHit(hb.move, attacker.pos.x, attacker, this);
      if (res !== 'ignore') attacker.attack.hasHit = true;
    }
  }

  _separateBodies(p1, p2) {
    const a = p1.getHurtbox(), b = p2.getHurtbox();
    // On ne sépare que si les tranches verticales se chevauchent (permet
    // les cross-ups en saut par-dessus l'adversaire).
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

  _updateProjectiles() {
    const fighting = this.phase === 'fight';
    for (const pr of this.projectiles) {
      pr.x += pr.vx;
      pr.age++;
      pr.life--;
      if (pr.x < -40 || pr.x > STAGE_W + 40) pr.life = 0;

      if (fighting) {
        const target = pr.owner === 'p1' ? this.fighters.p2 : this.fighters.p1;
        const box = { l: pr.x - pr.w / 2, r: pr.x + pr.w / 2, t: pr.y - pr.h / 2, b: pr.y + pr.h / 2 };
        if (this._overlap(box, target.getHurtbox())) {
          const owner = this.fighters[pr.owner];
          const res = target.takeHit(pr.move, pr.x, owner, this);
          if (res !== 'ignore') pr.life = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------------
  // Effets & caméra
  // ------------------------------------------------------------------
  _spawnSpark(x, y, kind, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (i % 2) * 0.4;
      const spd = 1.5 + (i % 3);
      this.effects.push({
        x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 1,
        age: 0, life: 14 + (i % 6), kind, color, size: kind === 'heavy' ? 4 : 3,
      });
    }
  }

  // Gerbe d'étincelles projetée dans le sens du coup (dir = -1 | 1)
  _spawnSparkDir(x, y, dir, kind, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const spd = 2 + Math.random() * 3.5;
      this.effects.push({
        x, y,
        vx: dir * spd + (Math.random() - 0.5) * 1.8,
        vy: (Math.random() - 0.72) * 3.2,
        age: 0, life: 12 + (i % 6), kind, color, size: kind === 'heavy' ? 4 : 3,
      });
    }
  }

  _spawnLandDust(f) {
    for (let i = 0; i < 5; i++) {
      const s = i / 4 - 0.5;
      this.effects.push({
        x: f.pos.x + s * 16, y: f.pos.y - 2,
        vx: s * 2.4, vy: -0.6 - Math.random(),
        age: 0, life: 12 + (i % 4), kind: 'dust', color: '#cbb89a', size: 2,
      });
    }
  }

  _updateCombos() {
    for (const slot of ['p1', 'p2']) {
      const c = this.combo[slot];
      if (c.timer > 0) { c.timer--; if (c.timer === 0) c.count = 0; }
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
    const p1 = this.fighters.p1, p2 = this.fighters.p2;
    if (!p1 || !p2) return;
    const margin = 150;
    const minX = Math.min(p1.pos.x, p2.pos.x) - margin;
    const maxX = Math.max(p1.pos.x, p2.pos.x) + margin;
    const span = Math.max(280, maxX - minX);
    let zoom = this.viewW / span;
    zoom = Math.max(0.72, Math.min(1.18, zoom));
    const mid = (p1.pos.x + p2.pos.x) / 2;
    let camX = mid - (this.viewW / zoom) / 2;
    camX = Math.max(0, Math.min(STAGE_W - this.viewW / zoom, camX));
    // Lissage
    this.camera.x += (camX - this.camera.x) * 0.18;
    this.camera.zoom += (zoom - this.camera.zoom) * 0.12;
  }

  // ------------------------------------------------------------------
  // Événements appelés par les combattants
  // ------------------------------------------------------------------
  onAttackStart(fighter, kind, move) {
    if (kind !== 'light') this.hooks.onEvent('whiff', { slot: fighter.slot, kind });
  }

  onHit(defender, attacker, move, dmg, dir) {
    if (attacker) {
      const c = this.combo[attacker.slot];
      c.count = c.timer > 0 ? c.count + 1 : 1;
      c.timer = 50;
    }
    const cx = (defender.pos.x + (attacker ? attacker.pos.x : defender.pos.x)) / 2;
    const cy = defender.pos.y - defender.char.body.h * defender.scale * 0.55;
    const heavy = dmg >= 11;
    this._spawnSparkDir(cx, cy, dir, heavy ? 'heavy' : 'light', '#fff4b0', heavy ? 12 : 7);
    this.shake = Math.max(this.shake, heavy ? 10 : 5);
    this.hitStop = heavy ? 5 : 3;
    this.hooks.onEvent('hit', { slot: defender.slot, atk: attacker && attacker.slot, heavy, dmg });
  }

  onThrow(defender, attacker, dmg, dir) {
    const cx = defender.pos.x;
    const cy = defender.pos.y - defender.char.body.h * defender.scale * 0.5;
    this._spawnSpark(cx, cy, 'heavy', '#ffd24a', 14);
    this.shake = Math.max(this.shake, 13);
    this.hitStop = 6;
    if (attacker) { const c = this.combo[attacker.slot]; c.count = 0; c.timer = 0; }
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
      this.effects.push({
        x: fighter.pos.x - fighter.facing * (6 + i * 4), y: fighter.pos.y - 2,
        vx: -fighter.facing * (0.5 + i * 0.3), vy: -0.4,
        age: 0, life: 10 + i * 2, kind: 'dust', color: '#c9b89a', size: 2,
      });
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

  onKO(fighter) {
    this.shake = Math.max(this.shake, 18);
    this.hitStop = 10;
    this.flash = 8;
    this.slowmo = 48; // ralenti dramatique sur le coup fatal
    this._spawnSpark(fighter.pos.x, fighter.pos.y - 40, 'heavy', '#ff5a5a', 18);
  }

  onTransform(fighter) {
    this.shake = Math.max(this.shake, 12);
    this.flash = 8;
    this.hitStop = 4;
    const aura = fighter.char.formAura[fighter.formIndex] || '#ffffff';
    this._spawnSpark(fighter.pos.x, fighter.pos.y - 45, 'heavy', aura, 18);
    // Onde de choc : repousse l'adversaire s'il est proche.
    const other = fighter.slot === 'p1' ? this.fighters.p2 : this.fighters.p1;
    if (other && Math.abs(other.pos.x - fighter.pos.x) < 120) {
      const dir = other.pos.x >= fighter.pos.x ? 1 : -1;
      other.vel.x = dir * 8; other.vel.y = -5; other.onGround = false;
    }
    this.announce = {
      text: fighter.char.formNames[fighter.formIndex].toUpperCase(),
      sub: 'RAGE !', timer: 70, big: false, slot: fighter.slot,
    };
    this.hooks.onEvent('transform', { slot: fighter.slot, form: fighter.formIndex });
  }

  get timeLeft() {
    return Math.max(0, Math.ceil(this.roundTimer / 60));
  }
}
