/**
 * Fighter — un combattant : physique + machine à états + rage.
 *
 * Tout est piloté par pas fixe (60 Hz). Les entrées arrivent par
 * événements (setInput) ce qui, combiné à un petit buffer, garde les
 * actions ultra réactives même en fin d'animation.
 *
 * Palette de coups :
 *  - Coup léger / lourd (au sol, accroupi = version basse, en l'air = saut)
 *  - Spécial (change selon la forme de rage)
 *  - Projection : Garde + Coup au corps-à-corps (imparable, bat la garde)
 *  - Dash avant / arrière : double-appui ◀◀ ou ▶▶ (le dash arrière a des i-frames)
 *  - Combos : on annule la récupération d'un coup qui touche vers un coup plus fort
 *  - Super (forme furie) : gros dégâts + armure (encaisse un coup à l'armement)
 */

import {
  GRAVITY, MAX_FALL, FRICTION_GROUND, FRICTION_AIR, GROUND_Y, STAGE_W,
  START_HEALTH, RAGE_MAX, RAGE_THRESHOLDS, STATE,
  DOUBLE_TAP_FRAMES, DASH_FRAMES, DASH_SPEED, BACKDASH_SPEED, BACKDASH_INVULN,
  MAX_COMBO_CHAIN, GRAB_RANGE, SPECIAL_SALVO, SPECIAL_LOCK_FRAMES,
} from './constants.js';
import { FORMS } from './characters.js';

const BUFFER_FRAMES = 6;   // tolérance d'anticipation d'une action
const TRANSFORM_FRAMES = 26;
const RANK = { light: 1, heavy: 2, special: 3 };

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
    this.attack = null; // { move, kind, box, low, aerial, isThrow, phase, timer, hasHit, spawnedProj, armor }

    this.input = { left: false, right: false, up: false, down: false, punch: false, kick: false, special: false, block: false };
    this.jumpBuffer = 0;
    this.attackBuffer = null; // { kind, frames }
    this.dashBuffer = null;   // { dir, frames }
    this.lastTapDir = 0;
    this.lastTapFrame = -999;

    this.dashTimer = 0;
    this.dashForward = true;
    this.comboChain = 0;   // nb de coups enchaînés par cancel
    this.armorActive = false;
    this.specialCount = 0; // spéciaux tirés dans la salve courante
    this.specialLock = 0;  // recharge forcée après une salve (frames)

    this.invuln = 0;      // frames d'invincibilité (transform / backdash)
    this.blockFlash = 0;  // effet visuel de garde
    this.hitFlash = 0;    // clignotement quand touché
    this.tumbling = 0;    // roule-boule après une projection
    this.landSquash = 0;  // écrasement à l'atterrissage (juice)
    this.onPlatform = null; // y de la plateforme sous les pieds (ou null)
    this.dropThrough = 0;   // frames où l'on traverse les plateformes (↓)
    this.animTime = 0;    // horloge pour les animations de rendu
    this.wins = 0;
  }

  // --- Entrées (événementiel = latence minimale) ---
  setInput(btn, down) {
    if (this.input[btn] === down) return;
    this.input[btn] = down;
    if (!down) return;
    switch (btn) {
      case 'up': this.jumpBuffer = BUFFER_FRAMES; break;
      case 'jump': this.jumpBuffer = BUFFER_FRAMES; break; // bouton saut dédié (manette)
      case 'punch':
        // Garde maintenue + Coup = projection
        this.attackBuffer = { kind: this.input.block ? 'throw' : 'light', frames: BUFFER_FRAMES };
        break;
      case 'kick': this.attackBuffer = { kind: 'heavy', frames: BUFFER_FRAMES }; break;
      case 'special': this.attackBuffer = { kind: 'special', frames: BUFFER_FRAMES }; break;
      case 'left': this._tap(-1); break;
      case 'right': this._tap(1); break;
    }
  }

  _tap(dir) {
    if (this.lastTapDir === dir && (this.animTime - this.lastTapFrame) <= DOUBLE_TAP_FRAMES) {
      this.dashBuffer = { dir, frames: BUFFER_FRAMES };
      this.lastTapDir = 0;
    } else {
      this.lastTapDir = dir;
      this.lastTapFrame = this.animTime;
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
    this.dashBuffer = null;
    this.dashTimer = 0;
    this.comboChain = 0;
    this.armorActive = false;
    this.specialCount = 0;
    this.specialLock = 0;
    this.invuln = 0;
    this.tumbling = 0;
    this.landSquash = 0;
    this.onPlatform = null;
    this.dropThrough = 0;
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
    if (this.state === STATE.CROUCH || (this.attack && this.attack.low)) h *= 0.62;
    return { l: this.pos.x - w / 2, r: this.pos.x + w / 2, t: this.pos.y - h, b: this.pos.y };
  }

  // Hitbox active de l'attaque corps-à-corps en cours (ou null).
  getActiveHitbox() {
    const a = this.attack;
    if (!a || a.phase !== 'active' || a.hasHit) return null;
    const s = this.scale;

    if (a.isThrow) {
      const reach = GRAB_RANGE * s;
      const cx = this.pos.x + this.facing * reach * 0.5;
      return {
        l: cx - reach * 0.5, r: cx + reach * 0.5,
        t: this.pos.y - 78 * s, b: this.pos.y,
        move: a.move, kind: 'throw',
      };
    }
    if (a.move.type === 'projectile') return null; // géré par le moteur

    const b = a.box || a.move.box;
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
      this.state !== STATE.HITSTUN && this.state !== STATE.KO &&
      this.state !== STATE.TRANSFORM && this.state !== STATE.DASH && !this.attack
    );
  }

  // --- Mise à jour d'un tick ---
  update(opponent, engine, active = true) {
    this.animTime++;
    if (this.blockFlash > 0) this.blockFlash--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.tumbling > 0) this.tumbling--;
    if (this.landSquash > 0) this.landSquash--;

    if (!active) { this._physics(engine); this._clampStage(); return; }

    if (this.jumpBuffer > 0) this.jumpBuffer--;
    if (this.attackBuffer && --this.attackBuffer.frames <= 0) this.attackBuffer = null;
    if (this.dashBuffer && --this.dashBuffer.frames <= 0) this.dashBuffer = null;
    if (this.invuln > 0) this.invuln--;
    if (this.specialLock > 0) this.specialLock--;

    this._updateForm(engine);

    if (this.state === STATE.KO) { this._physics(engine); return; }

    // Dash en cours (annulable par une attaque)
    if (this.state === STATE.DASH) {
      if (this.dashTimer > 0) this.dashTimer--;
      if (this.attackBuffer) {
        const kind = this.attackBuffer.kind;
        if (!(kind === 'special' && !this.onGround) && kind !== 'throw') {
          this.attackBuffer = null;
          this._startAttack(kind, engine);
        }
      }
      if (this.state === STATE.DASH && this.dashTimer <= 0) this.state = STATE.IDLE;
      this._physics(engine); this._clampStage();
      return;
    }

    // Orientation automatique face à l'adversaire quand on peut agir au sol.
    if (this.onGround && this.canAct() && opponent) {
      this.facing = opponent.pos.x >= this.pos.x ? 1 : -1;
    }

    if (this.attack) this._advanceAttack(engine);

    // Annulation (combo) : un coup qui touche s'annule vers un coup de rang >=
    if (this.attack && this.attack.phase === 'recovery' && this.attack.hasHit && this.attackBuffer) {
      const next = this.attackBuffer.kind;
      if (this._canCancel(next) && !(next === 'special' && !this.onGround)) {
        this.attackBuffer = null;
        this.comboChain = (this.comboChain || 1) + 1;
        this._startAttack(next, engine);
      }
    }

    if (this.stateTimer > 0) {
      this.stateTimer--;
      if (this.stateTimer === 0 && (this.state === STATE.HITSTUN || this.state === STATE.TRANSFORM)) {
        this.state = STATE.IDLE;
      }
    }

    if (this.canAct()) this._handleActions(engine);

    this._physics(engine);
    this._clampStage();
  }

  _canCancel(next) {
    if (next === 'throw') return false;
    if ((this.comboChain || 1) >= MAX_COMBO_CHAIN) return false;
    const cur = RANK[this.attack.kind] || 1;
    const nx = RANK[next] || 1;
    return nx >= cur;
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
    this.comboChain = 0;
    this.specialCount = 0;  // salve de spéciaux remise à zéro à chaque palier
    this.specialLock = 0;
    this.vel.x = 0;
    this.health = Math.min(START_HEALTH, this.health + 10);
    engine.onTransform(this);
  }

  _handleActions(engine) {
    const inp = this.input;

    // Dash (double-appui) — prioritaire, au sol
    if (this.onGround && this.dashBuffer) {
      const d = this.dashBuffer; this.dashBuffer = null;
      this._startDash(d.dir, engine);
      return;
    }

    // Saut bufferisé
    if (this.onGround && this.jumpBuffer > 0) {
      this.vel.y = -this.jumpForce;
      this.onGround = false;
      this.jumpBuffer = 0;
      this.state = STATE.JUMP;
    }

    // Attaque bufferisée
    if (this.attackBuffer) {
      const kind = this.attackBuffer.kind;
      if (kind === 'throw' && !this.onGround) {
        this.attackBuffer = null; // pas de projection en l'air
      } else if (kind === 'special' && !this.onGround) {
        // on garde le buffer pour déclencher à l'atterrissage
      } else {
        this.attackBuffer = null;
        this._startAttack(kind, engine);
        return;
      }
    }

    if (!this.attack) {
      if (this.onGround) {
        if (inp.block) { this.state = STATE.BLOCK; this.vel.x *= 0.6; }
        else if (inp.down && this.onPlatform != null) {
          // ↓ sur une plateforme => on redescend en la traversant
          this.onGround = false; this.onPlatform = null; this.dropThrough = 10;
          this.vel.y = 3; this.state = STATE.JUMP;
        }
        else if (inp.down) { this.state = STATE.CROUCH; this.vel.x *= 0.6; }
        else if (inp.left || inp.right) {
          const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
          this.vel.x += dir * this.char.accel;
          const max = this.moveSpeed;
          this.vel.x = Math.max(-max, Math.min(max, this.vel.x));
          this.state = STATE.WALK;
        } else {
          this.state = STATE.IDLE;
        }
      } else {
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        this.vel.x += dir * this.char.accel * 0.35;
        const max = this.moveSpeed * 1.1;
        this.vel.x = Math.max(-max, Math.min(max, this.vel.x));
        this.state = STATE.JUMP;
      }
    }
  }

  _startDash(dir, engine) {
    this.state = STATE.DASH;
    this.dashTimer = DASH_FRAMES;
    const forward = (dir === this.facing);
    this.dashForward = forward;
    this.vel.x = dir * (forward ? DASH_SPEED : BACKDASH_SPEED);
    this.vel.y = 0;
    if (!forward) this.invuln = Math.max(this.invuln, BACKDASH_INVULN);
    engine.onDash(this, forward);
  }

  _startAttack(kind, engine) {
    if (kind === 'throw') return this._startThrow(engine);
    if (kind === 'special' && this.specialLock > 0) return; // spéciaux en recharge

    let move;
    if (kind === 'light') move = this.char.light;
    else if (kind === 'heavy') move = this.char.heavy;
    else move = this.char.specials[this.formIndex];

    let box = move.box;
    let low = false, aerial = false;
    if (move.box) {
      if (!this.onGround) {
        aerial = true;
        box = { ...move.box, fy: Math.max(8, move.box.fy - 26), hh: move.box.hh + 6 };
      } else if (this.input.down) {
        low = true;
        box = { ...move.box, fy: 20, hh: 12 };
      }
    }

    this.attack = {
      move, kind, box, low, aerial, isThrow: false,
      phase: 'startup', timer: move.startup,
      hasHit: false, spawnedProj: false, armor: !!move.armor,
    };
    this.armorActive = !!move.armor;
    if (!this.comboChain) this.comboChain = 1;
    this.state = STATE.ATTACK;
    if (this.onGround) this.vel.x *= 0.5;
    if (kind === 'special') {
      this.specialCount++;
      if (this.specialCount >= SPECIAL_SALVO) { this.specialLock = SPECIAL_LOCK_FRAMES; this.specialCount = 0; }
    }
    engine.onAttackStart(this, kind, move);
  }

  _startThrow(engine) {
    const move = this.char.throw;
    this.attack = {
      move, kind: 'throw', box: null, low: false, aerial: false, isThrow: true,
      phase: 'startup', timer: move.startup,
      hasHit: false, spawnedProj: false, armor: false,
    };
    this.state = STATE.ATTACK;
    this.vel.x *= 0.3;
    engine.onAttackStart(this, 'throw', move);
  }

  _advanceAttack(engine) {
    const a = this.attack;
    a.timer--;
    if (a.timer > 0) return;

    if (a.phase === 'startup') {
      a.phase = 'active';
      a.timer = a.move.active || 3;
      this.armorActive = false; // l'armure ne couvre que l'armement
      if (a.move.type === 'projectile' && !a.spawnedProj) {
        a.spawnedProj = true;
        engine.spawnProjectile(this, a.move);
      }
    } else if (a.phase === 'active') {
      a.phase = 'recovery';
      a.timer = a.move.recovery;
    } else {
      this.attack = null;
      this.state = STATE.IDLE;
      this.comboChain = 0;
    }
  }

  _physics(engine) {
    const prevY = this.pos.y;
    if (!this.onGround) {
      this.vel.y += GRAVITY;
      if (this.vel.y > MAX_FALL) this.vel.y = MAX_FALL;
    }
    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;
    if (this.dropThrough > 0) this.dropThrough--;

    const plats = (engine && engine.platforms) || [];

    // Posé sur une plateforme : on tombe si on sort de sa largeur
    if (this.onGround && this.onPlatform != null) {
      const still = plats.find((p) => Math.abs(p.y - this.onPlatform) < 2 &&
        this.pos.x > p.x - p.w / 2 && this.pos.x < p.x + p.w / 2);
      if (!still) { this.onGround = false; this.onPlatform = null; }
    }

    // Atterrissage sur une plateforme (sens unique) : en chute, hors traversée
    let landed = false;
    if (this.vel.y >= 0 && this.dropThrough <= 0) {
      for (const p of plats) {
        if (prevY <= p.y + 2 && this.pos.y >= p.y &&
            this.pos.x > p.x - p.w / 2 - 4 && this.pos.x < p.x + p.w / 2 + 4) {
          this.pos.y = p.y; this.vel.y = 0;
          if (!this.onGround) {
            this.onGround = true; this.landSquash = 8;
            if (this.state === STATE.JUMP) this.state = STATE.IDLE;
            if (this.tumbling > 0) this.vel.x *= 0.5;
          }
          this.onPlatform = p.y; landed = true;
          break;
        }
      }
    }

    // Sol
    if (!landed) {
      if (this.pos.y >= GROUND_Y) {
        this.pos.y = GROUND_Y;
        this.vel.y = 0;
        if (!this.onGround) {
          this.onGround = true;
          this.landSquash = 8; // écrasement à la réception (juice)
          if (this.state === STATE.JUMP) this.state = STATE.IDLE;
          if (this.tumbling > 0) this.vel.x *= 0.5; // rebond mou après projection
        }
        this.onPlatform = null;
      } else {
        this.onGround = false;
      }
    }

    if (this.onGround) {
      if (this.state === STATE.DASH) this.vel.x *= 0.9;
      else if (this.state !== STATE.WALK) this.vel.x *= FRICTION_GROUND;
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

  /** Reçoit un coup. Renvoie 'hit' | 'block' | 'armor' | 'ignore'. */
  takeHit(move, fromX, attacker, engine) {
    if (this.invuln > 0 || this.state === STATE.KO) return 'ignore';
    const dir = this.pos.x >= fromX ? 1 : -1; // sens du recul (loin de l'attaquant)
    const attackerForm = attacker ? attacker.form : FORMS[0];

    // --- Projection : imparable, mais uniquement au sol ---
    if (move.type === 'grab') {
      if (!this.onGround) return 'ignore';
      const dmg = Math.round(move.dmg * attackerForm.dmgMul * this.form.defMul);
      this.health = Math.max(0, this.health - dmg);
      this.rage = Math.min(RAGE_MAX, this.rage + dmg * 0.9); // la rage monte quand on encaisse
      this.attack = null;
      this.comboChain = 0;
      this.state = STATE.HITSTUN;
      this.stateTimer = move.hitstun;
      this.tumbling = move.hitstun;
      this.hitFlash = 6;
      this.vel.x = dir * move.kb.x;
      this.vel.y = move.kb.y;
      this.onGround = false;
      engine.onThrow(this, attacker, dmg, dir);
      if (this.health <= 0) this._ko(engine);
      return 'hit';
    }

    // --- Garde ---
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

    // --- Super armor (armement d'un super) : encaisse un coup ---
    if (this.armorActive) {
      const dmg = Math.round(move.dmg * attackerForm.dmgMul * this.form.defMul * 0.5);
      this.health = Math.max(0, this.health - dmg);
      this.rage = Math.min(RAGE_MAX, this.rage + dmg * 0.5);
      this.armorActive = false;
      this.hitFlash = 4;
      engine.onArmor(this, dir);
      if (this.health <= 0) this._ko(engine);
      return 'armor';
    }

    // --- Coup normal ---
    const dmg = Math.round(move.dmg * attackerForm.dmgMul * this.form.defMul);
    this.health = Math.max(0, this.health - dmg);
    this.rage = Math.min(RAGE_MAX, this.rage + dmg * 0.9); // la rage monte quand on encaisse

    this.attack = null;
    this.comboChain = 0;
    this.armorActive = false;
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
    this.comboChain = 0;
    this.vel.x = (this.facing * -1) * 6;
    this.vel.y = -8;
    this.onGround = false;
    engine.onKO(this);
  }
}
