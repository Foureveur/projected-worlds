/**
 * ai.js — un adversaire contrôlé par l'ordinateur (mode 1 joueur).
 *
 * L'IA pilote un combattant exactement comme une manette : elle appelle
 * engine.setInput(slot, bouton, down). Elle prend une décision toutes les
 * quelques frames (pour ne pas trembler), en fonction de la distance à
 * l'adversaire et de son état.
 */

import { STATE } from './constants.js';

const ALL_BTN = ['left', 'right', 'up', 'down', 'punch', 'kick', 'special', 'block'];

export class AIController {
  constructor(slot, foeSlot, level = 1) {
    this.slot = slot;
    this.foeSlot = foeSlot;
    this.level = level;        // 1 = normal (réactivité + agressivité)
    this.decideIn = 0;
    this.held = {};            // boutons maintenus
    this.pendingUp = [];       // {btn, t} pour relâcher les "taps"
  }

  _set(engine, btn, down) {
    if (!!this.held[btn] === down) return;
    engine.setInput(this.slot, btn, down);
    this.held[btn] = down;
  }
  _releaseMovement(engine) {
    for (const b of ['left', 'right', 'up', 'down', 'block']) this._set(engine, b, false);
  }
  _releaseAll(engine) {
    for (const b of ALL_BTN) this._set(engine, b, false);
    this.pendingUp = [];
  }
  _tap(engine, btn, hold = 3) {
    this._set(engine, btn, true);
    this.pendingUp.push({ btn, t: hold });
  }

  _attack(engine, dist) {
    const r = Math.random();
    if (r < 0.5) this._tap(engine, 'punch');
    else if (r < 0.82) this._tap(engine, 'kick');
    else this._tap(engine, 'special');
  }

  update(engine) {
    const me = engine.fighters[this.slot];
    const foe = engine.fighters[this.foeSlot];
    if (!me || !foe) return;

    // Relâche les taps arrivés à terme
    for (const p of this.pendingUp) { if (--p.t <= 0) this._set(engine, p.btn, false); }
    this.pendingUp = this.pendingUp.filter((p) => p.t > 0);

    if (engine.phase !== 'fight') { this._releaseAll(engine); return; }
    if (me.state === STATE.HITSTUN || me.state === STATE.KO || me.state === STATE.TRANSFORM) {
      this._releaseMovement(engine);
      return;
    }

    if (this.decideIn > 0) { this.decideIn--; return; }

    const dx = foe.pos.x - me.pos.x;
    const dist = Math.abs(dx);
    const dir = dx >= 0 ? 'right' : 'left';
    const away = dx >= 0 ? 'left' : 'right';
    const range = 64 * me.scale;
    const react = this.level >= 1 ? 1 : 1.6;

    this._releaseMovement(engine);

    if (dist > range + 30) {
      // Trop loin : on avance
      this._set(engine, dir, true);
      this.decideIn = Math.round((6 + Math.random() * 8) * react);
    } else if (dist > range) {
      // Zone d'approche : entrer ou tenter un coup
      if (Math.random() < 0.55) { this._set(engine, dir, true); this.decideIn = 5; }
      else { this._attack(engine, dist); this.decideIn = Math.round((12 + Math.random() * 10) * react); }
    } else {
      // Au corps-à-corps
      const roll = Math.random();
      if (foe.attack && foe.attack.phase !== 'recovery' && roll < 0.32 * this.level) {
        this._set(engine, 'block', true);               // parer une attaque en cours
        this.decideIn = 8 + Math.round(Math.random() * 10);
      } else if (roll < 0.12) {
        this._set(engine, 'block', true); this._tap(engine, 'punch'); // projection (Garde+Coup)
        this.decideIn = 14;
      } else if (roll > 0.9) {
        this._set(engine, away, true);                  // petit recul
        this.decideIn = 6 + Math.round(Math.random() * 6);
      } else {
        this._attack(engine, dist);
        this.decideIn = Math.round((9 + Math.random() * 12) * react);
      }
    }

    // Saut occasionnel
    if (Math.random() < 0.03) this._tap(engine, 'up');
  }
}
