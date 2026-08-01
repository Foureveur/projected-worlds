/**
 * Fighter — un combattant : physique + machine à états + rage.
 *
 * Tout est piloté par pas fixe (60 Hz). Les entrées arrivent par
 * événements (setInput) ce qui, combiné à un petit buffer, garde les
 * actions ultra réactives même en fin d'animation.
 */

import {
  GRAVITY, MAX_FALL, FRICTION_GROUND, FRICTION_AIR, GROUND_Y, STAGE_W,
  START_HEALTH, RAGE_MAX, RAGE_THRESHOLDS, STATE,
} from './constants.js';
import { FORMS } from './characters.js';

const BUFFER_FRAMES = 6;   // tolérance d'anticipation d'une action
const TRANSFORM_FRAMES = 26;

export class Fighter {
  constructor(charDef, slot, startX, facing) {
    this.char = charDef;
    this.slot = slot; // 'p1' | 'p2'
    this.pos = { x: startX, y: GROUND_Y };
    this.vel = { x: 0, y: 0 };
    this.facing = facing; // 1 = regarde à droite, -1 = à gauche
    this.onGround = true;

    this.health = START_HEALTH;
    this.rage = 0;
    this.formIndex = 0;

    this.state = STATE.IDLE;
    this.stateTimer = 0;
    this.attack = null; // { move, kind, phase, timer, hasHit, spawnedProj }

    this.input = { left: false, right: false, up: false, down: false, punch: false, kick: false, special: false, block: false };
    this.jumpBuffer = 0;
    this.attackBuffer = null; // { kind, frames }

    this.invuln = 0;      // frames d'invincibilité (transform)
    this.blockFlash = 0;  // pour l'effet visuel de garde
    this.hitFlash = 0;    // pour le clignotement quand touché
    this.animTime = 0;    // horloge pour les animations de rendu
    this.wins = 0;
  }

  // --- Entrées (événementiel = latence minimale) ---
  setInput(btn, down) {
    if (this.input[btn] === down) return;
    this.input[btn] = down;
    if (down) {
      if (btn === 'up') this.jumpBuffer = BUFFER_FRAMES;
      else if (btn === 'punch') this.attackBuffer = { kind: 'light', frames: BUFFER_FRAMES };
      else if (btn === 'kick') this.attackBuffer = { kind: 'heavy', frames: BUFFER_FRAMES };
      else if (btn === 'special') this.attackBuffer = { kind: 'special', frames: BUFFER_FRAMES };
    }
  }

  resetForRound(startX, facing) {
    this.pos = { x: startX, y: GROUND_Y };
    this.vel = { x: 0, y: 0 };
    this.facing = facing;
    this.health = START_HEALTH;
    this.rage = 0;
    this.formIndex = 0;
    this.state = STATE.IDLE;
    this.stateTimer = 0;
    this.attack = null;
    this.jumpBuffer = 0;
    this.attackBuffer = null;
    this.invuln = 0;
    this.onGround = true;
    for (const k in this.input) this.input[k] = false;
  }

  get form() { return FORMS[this.formIndex]; }
  get scale() { return this.form.scale; }

  get moveSpeed() { return this.char.speed * this.form.speedMul; }
  get jumpForce() { return this.char.jump * (1 + (this.form.speedMul - 1) * 0.45); }

  // --- Boîtes de collision (AABB), centrées sur le combattant ---
  getHurtbox() {
    const s = this.scale;
    const w = this.char.body.w * s;
    let h = this.char.body.h * s;
    if (this.state === STATE.CROUCH) h *= 0.62;
    return {
      l: this.pos.x - w / 2,
      r: this.pos.x + w / 2,
      t: this.pos.y - h,
      b: this.pos.y,
    };
  }

  // Hitbox active de l'attaque au corps-à-corps en cours (ou null).
  getActiveHitbox() {
    const a = this.attack;
    if (!a || a.phase !== 'active' || a.hasHit) return null;
    if (a.move.type === 'projectile') return null; // géré par le moteur
    const s = this.scale;
    const b = a.move.box;
    const cx = this.pos.x + this.facing * b.fx * s;
    const cy = this.pos.y - b.fy * s;
    return {
      l: cx - b.hw * s, r: cx + b.hw * s,
      t: cy - b.hh * s, b: cy + b.hh * s,
      move: a.move, kind: a.kind,
    };
  }

  canAct() {
    return (
      this.state !== STATE.HITSTUN &&
      this.state !== STATE.KO &&
      this.state !== STATE.TRANSFORM &&
      !this.attack
    );
  }

  // --- Mise à jour d'un tick ---
  // active=false => round figé (intro / fin de round) : la physique
  // continue (chute d'un KO, etc.) mais les entrées sont ignorées.
  update(opponent, engine, active = true) {
    this.animTime++;
    if (this.blockFlash > 0) this.blockFlash--;
    if (this.hitFlash > 0) this.hitFlash--;

    if (!active) {
      this._physics();
      this._clampStage();
      return;
    }

    if (this.jumpBuffer > 0) this.jumpBuffer--;
    if (this.attackBuffer) { if (--this.attackBuffer.frames <= 0) this.attackBuffer = null; }
    if (this.invuln > 0) this.invuln--;

    this._updateForm(engine);

    if (this.state === STATE.KO) {
      this._physics();
      return;
    }

    // Orientation automatique face à l'adversaire quand on peut agir au sol.
    if (this.onGround && this.canAct() && opponent) {
      this.facing = opponent.pos.x >= this.pos.x ? 1 : -1;
    }

    // Progression de l'attaque en cours
    if (this.attack) this._advanceAttack(engine);

    // Décompte des états temporisés
    if (this.stateTimer > 0) {
      this.stateTimer--;
      if (this.stateTimer === 0) {
        if (this.state === STATE.HITSTUN || this.state === STATE.TRANSFORM) {
          this.state = STATE.IDLE;
        }
      }
    }

    // Décisions (mouvement / actions) si on peut agir
    if (this.canAct()) this._handleActions(engine);

    this._physics();
    this._clampStage();
  }

  _updateForm(engine) {
    if (this.rage > RAGE_MAX) this.rage = RAGE_MAX;
    let target = 0;
    for (let i = RAGE_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.rage >= RAGE_THRESHOLDS[i]) { target = i; break; }
    }
    if (target > this.formIndex) {
      this.formIndex = target;
      this._transform(engine);
    }
  }

  _transform(engine) {
    this.state = STATE.TRANSFORM;
    this.stateTimer = TRANSFORM_FRAMES;
    this.invuln = TRANSFORM_FRAMES;
    this.attack = null;
    this.vel.x = 0;
    // Petit soin en récompense de l'agressivité qui a rempli la rage.
    this.health = Math.min(START_HEALTH, this.health + 10);
    engine.onTransform(this);
  }

  _handleActions(engine) {
    const inp = this.input;

    // Sauter (bufferisé) — seulement au sol
    if (this.onGround && this.jumpBuffer > 0) {
      this.vel.y = -this.jumpForce;
      this.onGround = false;
      this.jumpBuffer = 0;
      this.state = STATE.JUMP;
    }

    // Attaque bufferisée
    if (this.attackBuffer) {
      const kind = this.attackBuffer.kind;
      // Les spéciaux sont au sol uniquement
      if (kind === 'special' && !this.onGround) {
        // on garde le buffer un peu pour déclencher à l'atterrissage
      } else {
        this.attackBuffer = null;
        this._startAttack(kind, engine);
        return;
      }
    }

    if (!this.attack) {
      if (this.onGround) {
        if (inp.block) {
          this.state = STATE.BLOCK;
          this.vel.x *= 0.6;
        } else if (inp.down) {
          this.state = STATE.CROUCH;
          this.vel.x *= 0.6;
        } else if (inp.left || inp.right) {
          const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
          this.vel.x += dir * this.char.accel;
          const max = this.moveSpeed;
          if (this.vel.x > max) this.vel.x = max;
          if (this.vel.x < -max) this.vel.x = -max;
          this.state = STATE.WALK;
        } else {
          this.state = STATE.IDLE;
        }
      } else {
        // Contrôle aérien léger
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        this.vel.x += dir * this.char.accel * 0.35;
        const max = this.moveSpeed * 1.1;
        if (this.vel.x > max) this.vel.x = max;
        if (this.vel.x < -max) this.vel.x = -max;
        this.state = STATE.JUMP;
      }
    }
  }

  _startAttack(kind, engine) {
    let move;
    if (kind === 'light') move = this.char.light;
    else if (kind === 'heavy') move = this.char.heavy;
    else move = this.char.specials[this.formIndex];

    this.attack = {
      move, kind,
      phase: 'startup',
      timer: move.startup,
      hasHit: false,
      spawnedProj: false,
    };
    this.state = STATE.ATTACK;
    if (this.onGround) this.vel.x *= 0.5;
    engine.onAttackStart(this, kind, move);
  }

  _advanceAttack(engine) {
    const a = this.attack;
    a.timer--;
    if (a.timer > 0) return;

    if (a.phase === 'startup') {
      a.phase = 'active';
      a.timer = a.move.active || 4;
      // Projectile : on le lâche au début de la phase active.
      if (a.move.type === 'projectile' && !a.spawnedProj) {
        a.spawnedProj = true;
        engine.spawnProjectile(this, a.move);
      }
    } else if (a.phase === 'active') {
      a.phase = 'recovery';
      a.timer = a.move.recovery;
    } else {
      // fini
      this.attack = null;
      this.state = STATE.IDLE;
    }
  }

  _physics() {
    // Gravité
    if (!this.onGround) {
      this.vel.y += GRAVITY;
      if (this.vel.y > MAX_FALL) this.vel.y = MAX_FALL;
    }
    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;

    // Sol
    if (this.pos.y >= GROUND_Y) {
      this.pos.y = GROUND_Y;
      this.vel.y = 0;
      if (!this.onGround) {
        this.onGround = true;
        if (this.state === STATE.JUMP) this.state = STATE.IDLE;
      }
    } else {
      this.onGround = false;
    }

    // Friction
    if (this.onGround) {
      if (this.state !== STATE.WALK) this.vel.x *= FRICTION_GROUND;
      else this.vel.x *= 0.92;
    } else {
      this.vel.x *= FRICTION_AIR;
    }
    if (Math.abs(this.vel.x) < 0.05) this.vel.x = 0;
  }

  _clampStage() {
    const half = (this.char.body.w * this.scale) / 2;
    if (this.pos.x < half) { this.pos.x = half; if (this.vel.x < 0) this.vel.x = 0; }
    if (this.pos.x > STAGE_W - half) { this.pos.x = STAGE_W - half; if (this.vel.x > 0) this.vel.x = 0; }
  }

  isBlocking() {
    return this.state === STATE.BLOCK && this.onGround;
  }

  /** Reçoit un coup (corps-à-corps ou projectile). Renvoie 'hit' | 'block' | 'ignore'. */
  takeHit(move, fromX, attacker, engine) {
    if (this.invuln > 0 || this.state === STATE.KO) return 'ignore';

    const dir = this.pos.x >= fromX ? 1 : -1; // sens du recul
    const attackerForm = attacker ? attacker.form : FORMS[0];

    // Garde : il faut bloquer ET regarder vers l'attaquant.
    const facingAttacker = (this.facing === -dir);
    if (this.isBlocking() && facingAttacker) {
      const chip = Math.max(1, Math.round(move.dmg * 0.15 * attackerForm.dmgMul));
      this.health = Math.max(0, this.health - chip);
      this.rage = Math.min(RAGE_MAX, this.rage + 3);
      this.vel.x = dir * 3;
      this.blockFlash = 8;
      engine.onBlock(this, dir);
      if (this.health <= 0) this._ko(engine);
      return 'block';
    }

    const dmg = Math.round(move.dmg * attackerForm.dmgMul * this.form.defMul);
    this.health = Math.max(0, this.health - dmg);
    this.rage = Math.min(RAGE_MAX, this.rage + dmg * 0.75);
    if (attacker) attacker.rage = Math.min(RAGE_MAX, attacker.rage + dmg * 0.35);

    this.attack = null;
    this.state = STATE.HITSTUN;
    this.stateTimer = move.hitstun;
    this.hitFlash = 6;
    this.vel.x = dir * move.kb.x;
    this.vel.y = move.kb.y;
    if (move.kb.y < 0) this.onGround = false;

    engine.onHit(this, attacker, move, dmg, dir);
    if (this.health <= 0) this._ko(engine);
    return 'hit';
  }

  _ko(engine) {
    this.state = STATE.KO;
    this.stateTimer = 0;
    this.attack = null;
    this.vel.x = (this.facing * -1) * 6;
    this.vel.y = -8;
    this.onGround = false;
    engine.onKO(this);
  }
}
