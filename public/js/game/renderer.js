/**
 * Renderer — dessine tout le jeu en pixel-art procédural (aucune image à
 * charger). On rend dans un buffer this.W x this.H puis on l'agrandit en
 * CSS avec image-rendering: pixelated => rendu bien rétro et net.
 *
 * Repère "local" d'un combattant : origine aux pieds, +x vers l'avant
 * (selon l'orientation), +y vers le haut. On transforme local -> monde
 * -> écran via la caméra.
 */

import { STAGE_W, GROUND_Y, STATE, RAGE_MAX, RAGE_THRESHOLDS, ROUND_TIME } from './constants.js';

// Couleurs d'identification par joueur (mode smash)
const SLOT_COLORS = { p1: '#ff5bd0', p2: '#4ad6ff', p3: '#7ee081', p4: '#f5d90a' };
const SLOT_LABEL = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4' };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.t = 0;
    this.W = 640; this.H = 360; this.groundY = Math.round(this.H * 0.86);
    this.resize();
  }

  // Adapte la résolution interne au ratio réel de l'écran : plus de bandes
  // noires ni de déformation. Hauteur rétro fixe (360), largeur variable.
  resize() {
    const cw = this.canvas.clientWidth || window.innerWidth || 640;
    const ch = this.canvas.clientHeight || window.innerHeight || 360;
    const aspect = cw / Math.max(1, ch);
    this.H = 360;
    this.W = Math.max(480, Math.min(1000, Math.round(this.H * aspect)));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
    this.groundY = Math.round(this.H * 0.86);
    return this.W;
  }

  // monde -> écran
  w2s(cam, wx, wy) {
    return {
      x: (wx - cam.x) * cam.zoom,
      y: this.groundY - (GROUND_Y - wy) * cam.zoom,
    };
  }

  render(engine) {
    this.t++;
    const ctx = this.ctx;
    const cam = engine.camera;

    ctx.clearRect(0, 0, this.W, this.H);

    // Mode beat'em up : chemin de rendu dédié (rue + profondeur + HUD co-op)
    if (engine.mode === 'streets') { this._renderStreets(ctx, engine, cam); return; }

    // Avant la configuration (salon), on dessine juste le décor.
    const list = engine.fighterList || [];
    if (list.length === 0) {
      this._drawBackground(ctx, cam);
      this._drawGround(ctx, cam);
      return;
    }

    ctx.save();
    // Secousse d'écran
    if (engine.shake > 0.4) {
      const s = engine.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    this._drawBackground(ctx, cam);
    this._drawGround(ctx, cam);
    this._drawPlatforms(ctx, cam, engine);

    // Ombres
    for (const f of list) this._drawShadow(ctx, cam, f);

    // Combattants (le plus en retrait dessiné d'abord)
    const order = list.slice().sort((a, b) => a.pos.y - b.pos.y);
    for (const f of order) this._drawFighter(ctx, cam, f, engine);

    this._drawProjectiles(ctx, cam, engine);
    this._drawEffects(ctx, cam, engine);

    // Repères de joueur au-dessus des têtes (mode smash à 4)
    if (engine.mode === 'smash') this._drawPlayerTags(ctx, cam, engine);

    ctx.restore();

    // Flash plein écran
    if (engine.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${engine.flash / 16})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    if (engine.mode === 'smash') {
      this._drawSmashHUD(ctx, engine);
    } else {
      this._drawHUD(ctx, engine);
      this._drawCombo(ctx, engine);
    }
    this._drawAnnounce(ctx, engine);
  }

  // ------------------------------------------------------------------
  // Décor : salon de Mère-Grand, ambiance crépuscule
  // ------------------------------------------------------------------
  _drawBackground(ctx, cam) {
    // Mur en dégradé
    const g = ctx.createLinearGradient(0, 0, 0, this.groundY);
    g.addColorStop(0, '#3a2350');
    g.addColorStop(0.55, '#5a2f5e');
    g.addColorStop(1, '#7a3f55');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.groundY + 2);

    const px = -cam.x * cam.zoom * 0.3; // parallaxe lointaine

    // Grande fenêtre avec lune
    const winX = px + 60, winY = 28, winW = 150, winH = 120;
    ctx.fillStyle = '#20143a';
    ctx.fillRect(winX - 6, winY - 6, winW + 12, winH + 12);
    const sky = ctx.createLinearGradient(0, winY, 0, winY + winH);
    sky.addColorStop(0, '#101a3a');
    sky.addColorStop(1, '#2a2b5e');
    ctx.fillStyle = sky;
    ctx.fillRect(winX, winY, winW, winH);
    // Lune
    ctx.fillStyle = '#f4e9c1';
    ctx.beginPath();
    ctx.arc(winX + winW - 40, winY + 34, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a2148'; // croissant (masque une partie de la lune)
    ctx.beginPath();
    ctx.arc(winX + winW - 32, winY + 28, 15, 0, Math.PI * 2);
    ctx.fill();
    // Croisillons
    ctx.strokeStyle = '#20143a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(winX + winW / 2, winY); ctx.lineTo(winX + winW / 2, winY + winH);
    ctx.moveTo(winX, winY + winH / 2); ctx.lineTo(winX + winW, winY + winH / 2);
    ctx.stroke();

  }

  // Plateformes traversables (planches en bois)
  _drawPlatforms(ctx, cam, engine) {
    const plats = engine.platforms || [];
    for (const p of plats) {
      const left = this.w2s(cam, p.x - p.w / 2, p.y);
      const right = this.w2s(cam, p.x + p.w / 2, p.y);
      const w = right.x - left.x, h = 11 * cam.zoom;
      ctx.fillStyle = '#5a3b26'; ctx.fillRect(left.x, left.y, w, h);
      ctx.fillStyle = '#7a5236'; ctx.fillRect(left.x, left.y, w, 3);
      ctx.fillStyle = '#31200f'; ctx.fillRect(left.x, left.y + h - 3, w, 3);
      ctx.fillStyle = '#31200f';
      ctx.fillRect(left.x + 8, left.y + h, 5, 15 * cam.zoom);
      ctx.fillRect(right.x - 13, left.y + h, 5, 15 * cam.zoom);
    }
  }

  _drawGround(ctx, cam) {
    // Tapis / plancher
    ctx.fillStyle = '#3a231c';
    ctx.fillRect(0, this.groundY, this.W, this.H - this.groundY);
    ctx.fillStyle = '#4d2f24';
    ctx.fillRect(0, this.groundY, this.W, 5);
    // Lattes de parquet
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    const step = 46 * cam.zoom;
    const off = (-cam.x * cam.zoom) % step;
    for (let x = off; x < this.W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, this.groundY + 6);
      ctx.lineTo(x, this.H);
      ctx.stroke();
    }
  }

  _drawShadow(ctx, cam, f) {
    if (!f) return;
    const s = this.w2s(cam, f.pos.x, GROUND_Y);
    const w = f.char.body.w * f.scale * cam.zoom;
    // L'ombre rétrécit quand le perso saute
    const airFactor = Math.max(0.4, 1 - (GROUND_Y - f.pos.y) / 200);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(s.x, this.groundY + 2, (w * 0.7) * airFactor, 5 * cam.zoom * airFactor, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ------------------------------------------------------------------
  // Combattant
  // ------------------------------------------------------------------
  _drawFighter(ctx, cam, f, engine) {
    if (!f) return;
    const S = f.scale * cam.zoom;
    const pal = f.char.palette;
    const aura = f.char.formAura[f.formIndex];
    const t = f.animTime;
    const face = f.facing;
    const feet = this.w2s(cam, f.pos.x, f.pos.y);

    // Aura de rage (derrière le perso)
    if (aura) this._drawAura(ctx, cam, f, aura, S);

    // Traînées de dash
    if (f.state === STATE.DASH) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = aura || '#cfd6e6';
      for (let i = 1; i <= 3; i++) {
        ctx.fillRect(feet.x - face * i * 8 * S - 4 * S, feet.y - 66 * S, 4 * S, 56 * S);
      }
      ctx.restore();
    }

    // Helper : rectangle en coords locales (cx=avant, cy=haut depuis les pieds)
    const part = (cxL, cyL, w, h, color, r = 0) => {
      const sx = feet.x + face * cxL * S;
      const sy = feet.y - cyL * S;
      const pw = w * S, ph = h * S;
      ctx.fillStyle = color;
      if (r > 0) this._roundRect(ctx, sx - pw / 2, sy - ph / 2, pw, ph, r * S);
      else ctx.fillRect(Math.round(sx - pw / 2), Math.round(sy - ph / 2), Math.ceil(pw), Math.ceil(ph));
    };
    // Triangle pointe en haut (oreilles de loup)
    const tri = (cxL, cyL, w, h, color) => {
      const sx = feet.x + face * cxL * S, sy = feet.y - cyL * S;
      ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(sx, sy - h * S); ctx.lineTo(sx - w * S / 2, sy); ctx.lineTo(sx + w * S / 2, sy);
      ctx.closePath(); ctx.fill();
    };

    // Couleurs (avec ombrage 2 tons + effets)
    const flashing = f.hitFlash > 0 && (f.hitFlash % 2 === 0);
    const armorGlow = f.armorActive && Math.floor(this.t / 3) % 2 === 0;
    const tint = (c) => flashing ? '#ffffff' : armorGlow ? '#ffe6a0' : c;
    const skin = tint(pal.skin), skinSh = tint(this._shade(pal.skin, 0.78));
    const cloth = tint(pal.cloth), clothSh = tint(this._shade(pal.cloth, 0.66));
    const cloth2 = tint(pal.cloth2), hair = tint(pal.hair), hairSh = tint(this._shade(pal.hair, 0.72));
    const OUT = '#140a1e'; // contour sombre

    // --- KO (couché) ou projeté (roule-boule) ---
    const rolling = f.state === STATE.KO || f.tumbling > 0;
    if (rolling) {
      ctx.save();
      ctx.translate(feet.x, feet.y - (f.onGround ? 0 : 18 * S));
      const rot = f.state === STATE.KO ? face * -Math.PI / 2.1 : t * 0.5 * face;
      ctx.rotate(rot);
      ctx.fillStyle = OUT; ctx.fillRect(-15 * S, -35 * S, 30 * S, 42 * S);
      ctx.fillStyle = cloth; ctx.fillRect(-13 * S, -33 * S, 26 * S, 38 * S);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -44 * S, 11 * S, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.moveTo(-6 * S, -47 * S); ctx.lineTo(-2 * S, -43 * S);
      ctx.moveTo(-2 * S, -47 * S); ctx.lineTo(-6 * S, -43 * S);
      ctx.moveTo(3 * S, -47 * S); ctx.lineTo(7 * S, -43 * S);
      ctx.moveTo(7 * S, -47 * S); ctx.lineTo(3 * S, -43 * S);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // --- Paramètres de pose ---
    let bob = 0, lean = 0, legPhase = 0, crouch = 0, armExtend = 0, tuck = 0, dashLean = 0;
    if (f.state === STATE.WALK) { legPhase = Math.sin(t * 0.35); bob = Math.abs(Math.sin(t * 0.35)) * 2; }
    else if (f.state === STATE.IDLE || f.state === STATE.BLOCK) { bob = Math.sin(t * 0.08) * 1.2; }
    else if (f.state === STATE.JUMP) { tuck = 1; }
    else if (f.state === STATE.CROUCH) { crouch = 1; }
    else if (f.state === STATE.DASH) { dashLean = 1; }
    else if (f.state === STATE.HITSTUN) { lean = -0.35; }
    if (f.attack) {
      const ph = f.attack.phase;
      armExtend = ph === 'active' ? 1 : ph === 'startup' ? 0.4 : 0.55;
      if (f.attack.low) crouch = 1;
    }
    const isThrow = f.attack && f.attack.isThrow;
    const isAerial = f.attack && f.attack.aerial;

    const yScale = crouch ? 0.62 : 1;
    const legTop = 30 * yScale;
    const bodyTop = 58 * yScale;
    const headY = (68 * yScale) + bob;
    const reach = armExtend * 22;
    const armY = bodyTop - 8 + bob - lean * 10;
    const id = f.char.sprite || f.char.id;

    // --- Squash & stretch + lunge d'attaque (juice) ---
    let lunge = 0;
    if (f.attack && !isThrow) {
      const ph = f.attack.phase;
      lunge = ph === 'startup' ? -2 : ph === 'active' ? 5 : 1.5;
    }
    let sqx = 1, sqy = 1;
    if (!f.onGround) {
      const st = Math.max(-0.12, Math.min(0.16, -f.vel.y * 0.011));
      sqy = 1 + st; sqx = 1 - st * 0.7;
    }
    if (f.landSquash > 0) {
      const q = f.landSquash / 8;
      sqy = 1 - 0.24 * q; sqx = 1 + 0.24 * q;
    }
    feet.x += face * lunge * S;
    ctx.save();
    ctx.translate(feet.x, feet.y);
    ctx.scale(sqx, sqy);
    ctx.translate(-feet.x, -feet.y);

    // --- Jambes ---
    const legSwing = legPhase * 6;
    part(-6 + tuck * 5, legTop / 2 + bob, 10, legTop, clothSh);
    part(6 - tuck * 2 + dashLean * 6, legTop / 2 + bob, 10, legTop, cloth2);
    if (f.state === STATE.WALK) {
      part(-6 - legSwing, legTop / 2 + bob, 9, legTop, clothSh);
      part(6 + legSwing, legTop / 2 + bob, 9, legTop, cloth2);
    }
    // Coup de pied aérien : jambe tendue vers l'avant-bas
    if (isAerial && f.attack.kind === 'heavy') part(18 + reach * 0.4, 14, 20, 9, cloth2);
    // Pieds
    part(-6 + tuck * 4, 3 + bob, 12, 6, OUT);
    part(8 + dashLean * 6, 3 + bob, 12, 6, OUT);

    // --- Bras arrière ---
    part(-11, armY, 8, 20, skinSh);

    // --- Corps ---
    if (id === 'meregrand') {
      const by = legTop + (bodyTop - legTop) / 2 + bob;
      part(0, by, 36, bodyTop - legTop, OUT);           // contour
      part(0, by, 32, bodyTop - legTop - 2, cloth);     // robe
      part(face > 0 ? 6 : -6, by, 12, bodyTop - legTop - 2, clothSh); // ombre latérale
      part(0, legTop + 2 + bob, 40, 8, cloth);          // ourlet
      part(0, bodyTop - 4 + bob, 30, 8, pal.accent);    // châle
    } else {
      const by = legTop + (bodyTop - legTop) / 2 + bob;
      part(0, by, 32, bodyTop - legTop, OUT);
      part(0, by, 28, bodyTop - legTop - 2, cloth);     // chemise
      part(face > 0 ? 6 : -6, by, 10, bodyTop - legTop - 2, clothSh);
      part(0, legTop + 6 + bob, 30, 14, cloth2);        // ceinture pantalon
      part(2, by, 5, bodyTop - legTop - 6, pal.accent); // cravate
      if (f.formIndex >= 1) { part(-12, armY - 2, 7, 12, skin); part(11, armY - 2, 7, 12, skin); } // manches retroussées
    }

    // --- Tête ---
    part(0, headY, 24, 24, OUT, 7);
    part(0, headY, 21, 21, skin, 6);
    part(face > 0 ? 5 : -5, headY, 8, 21, skinSh, 4); // ombre du visage

    // Cheveux + costume par forme
    if (id === 'meregrand') {
      part(0, headY + 10, 27, 12, hairSh, 5);
      part(0, headY + 13, 26, 8, hair, 5);              // chignon
      part(0, headY + 17, 12, 10, hair, 4);
      part(4, headY + 1, 16, 6, pal.accent);           // lunettes
      if (f.formIndex >= 2) {                            // Grand-Mère Loup : oreilles + crocs
        tri(-8, headY + 13, 8, 11, hairSh);
        tri(8, headY + 13, 8, 11, hair);
        part(6, headY - 7, 4, 4, '#ffffff');            // croc
      }
    } else {
      part(-2, headY + 11, 25, 9, hairSh, 3);
      part(-1, headY + 12, 23, 6, hair, 3);             // cheveux courts
      part(1, headY - 8, 18, 6, this._shade(pal.hair, 0.9)); // moustache
      if (f.formIndex >= 1) part(6, headY + 7, 12, 3, OUT); // sourcil froncé
      if (f.formIndex >= 2) {                            // El Padre Furioso : flammes épaules
        ctx.save(); ctx.globalAlpha = 0.85;
        for (let i = 0; i < 2; i++) {
          const fx = -10 + i * 20;
          this._flame(ctx, feet.x + face * fx * S, feet.y - (bodyTop - 2) * S, 8 * S, 14 * S, t + i * 7);
        }
        ctx.restore();
      }
    }

    // --- Yeux ---
    const eyeColor = f.formIndex >= 2 ? '#ff2b2b' : '#222';
    part(3, headY + 3, 3, 3, '#fff');
    part(5, headY + 3, 3, 4, eyeColor);
    if (f.formIndex >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.4 + Math.sin(this.t * 0.3) * 0.3;
      part(5, headY + 3, 8, 8, '#ff5a5a');
      ctx.restore();
    }

    // --- Bras avant + arme ---
    if (isThrow) {
      // Pose de prise : deux bras tendus vers l'avant
      part(16, armY + 4, 16, 8, skin);
      part(16, armY - 6, 16, 8, skinSh);
    } else {
      part(12 + reach * 0.5, armY - (isAerial ? 8 : 0), 11, 8, skin);
      this._drawWeapon(ctx, part, f, 20 + reach, armY - (isAerial ? 8 : 0));
    }

    // --- Bras de garde ---
    if (f.state === STATE.BLOCK) {
      part(14, bodyTop - 2 + bob, 10, 26, skin);
      ctx.save();
      ctx.globalAlpha = 0.35 + (f.blockFlash > 0 ? 0.4 : 0);
      part(21, bodyTop - 6 + bob, 9, 36, '#8fd6ff');
      ctx.restore();
    }

    ctx.restore(); // fin du squash & stretch
  }

  _drawWeapon(ctx, part, f, x, y) {
    const id = f.char.sprite || f.char.id;
    const pal = f.char.palette;
    if (f.attack && f.attack.kind === 'special') return; // projectile : pas d'arme
    if (f.attack && f.attack.isThrow) return;
    if (id === 'meregrand') {
      part(x, y - 6, 6, 34, pal.weapon);              // canne
      part(x + 2, y + 8, 12, 6, pal.weapon);          // poignée
      if (f.formIndex >= 2) part(x, y - 22, 5, 6, '#dfe6ee'); // griffe en furie
    } else {
      if (f.attack && f.attack.kind === 'heavy') part(x + 4, y, 30, 6, pal.accent); // ceinture
      else part(x, y, 16, 8, pal.weapon);             // journal roulé
    }
  }

  // Petite flamme animée (furie de Padre)
  _flame(ctx, x, y, w, h, t) {
    const wob = Math.sin(t * 0.5) * 3;
    const cols = ['#ff3a1a', '#ff9c1a', '#ffe259'];
    for (let i = 0; i < 3; i++) {
      const s = 1 - i * 0.3;
      ctx.fillStyle = cols[i];
      ctx.beginPath();
      ctx.moveTo(x - w * s / 2, y);
      ctx.quadraticCurveTo(x + wob, y - h * s - 4, x + w * s / 2, y);
      ctx.closePath(); ctx.fill();
    }
  }

  _drawAura(ctx, cam, f, color, S) {
    const feet = this.w2s(cam, f.pos.x, f.pos.y - 40);
    const pulse = 0.6 + Math.sin(this.t * 0.25) * 0.25;
    const transforming = f.state === STATE.TRANSFORM;
    const rad = (f.formIndex >= 2 ? 44 : 34) * S * (transforming ? 1.4 : 1);
    ctx.save();
    ctx.globalAlpha = (transforming ? 0.85 : 0.4) * pulse;
    const g = ctx.createRadialGradient(feet.x, feet.y, rad * 0.2, feet.x, feet.y, rad);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(feet.x, feet.y, rad, 0, Math.PI * 2);
    ctx.fill();
    // Petites flammes/étincelles montantes en furie
    if (f.formIndex >= 2) {
      ctx.globalAlpha = 0.7 * pulse;
      ctx.fillStyle = color;
      for (let i = 0; i < 5; i++) {
        const a = this.t * 0.1 + i * 1.3;
        const fx = feet.x + Math.cos(a) * 24 * S;
        const fy = feet.y - ((this.t * 1.5 + i * 30) % 70) * S * 0.6;
        ctx.fillRect(fx, fy, 3 * S, 6 * S);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Projectiles
  // ------------------------------------------------------------------
  _drawProjectiles(ctx, cam, engine) {
    for (const p of engine.projectiles) {
      const s = this.w2s(cam, p.x, p.y);
      const w = p.w * cam.zoom, h = p.h * cam.zoom;
      ctx.save();
      ctx.translate(s.x, s.y);
      if (p.facing < 0) ctx.scale(-1, 1);
      const spin = p.age * 0.3;

      if (p.shape === 'candy') {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(-w / 2, -1, w, 2);
      } else if (p.shape === 'needle') {
        ctx.fillStyle = p.color; ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#f2c14e'; ctx.fillRect(w / 2 - 3, -h / 2, 3, h);
      } else if (p.shape === 'howl') {
        ctx.globalAlpha = 0.75;
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, w);
        g.addColorStop(0, '#fff'); g.addColorStop(0.4, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, w, h / 2, 0, 0, Math.PI * 2); ctx.fill();
      } else if (p.shape === 'remote') {
        ctx.rotate(spin); ctx.fillStyle = p.color; ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#e0392b'; ctx.fillRect(-w / 4, -h / 2 + 1, 3, 3);
      } else if (p.shape === 'slipper') {
        ctx.rotate(Math.sin(spin) * 0.5); ctx.fillStyle = p.color;
        this._roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
        ctx.fillStyle = '#4a2a12'; ctx.fillRect(-w / 2, -h / 2, w / 2, h);
      } else if (p.shape === 'fire') {
        ctx.globalAlpha = 0.9;
        for (let i = 0; i < 3; i++) {
          const rr = w / 2 - i * 4;
          ctx.fillStyle = i === 0 ? '#ffe259' : i === 1 ? '#ff9c1a' : '#ff3a1a';
          ctx.beginPath();
          ctx.moveTo(-rr, h / 3);
          ctx.quadraticCurveTo(0, -h / 2 - Math.sin(this.t * 0.5) * 4, rr, h / 3);
          ctx.closePath(); ctx.fill();
        }
      } else {
        ctx.fillStyle = p.color; ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }
  }

  _drawEffects(ctx, cam, engine) {
    for (const e of engine.effects) {
      const s = this.w2s(cam, e.x, e.y);
      const life = 1 - e.age / e.life;
      ctx.globalAlpha = life;
      ctx.fillStyle = e.color;
      const sz = e.size * cam.zoom * (0.6 + life * 0.6);
      if (e.kind === 'heavy') {
        // étoile d'impact
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(e.age);
        ctx.fillRect(-sz, -sz / 3, sz * 2, sz * 0.7);
        ctx.fillRect(-sz / 3, -sz, sz * 0.7, sz * 2);
        ctx.restore();
      } else {
        ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------
  // Smash : repères de joueur + HUD compact à 4
  // ------------------------------------------------------------------
  _drawPlayerTags(ctx, cam, engine) {
    for (const f of engine.fighterList) {
      if (f.eliminated || f.state === STATE.KO) continue;
      const col = SLOT_COLORS[f.slot] || '#fff';
      const head = this.w2s(cam, f.pos.x, f.pos.y + (f.char.body.h + 22) * f.scale);
      // Petit triangle pointant vers le bas + libellé
      ctx.save();
      ctx.globalAlpha = f.invuln > 0 && Math.floor(this.t / 3) % 2 === 0 ? 0.4 : 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(head.x, head.y + 8);
      ctx.lineTo(head.x - 6, head.y - 2);
      ctx.lineTo(head.x + 6, head.y - 2);
      ctx.closePath(); ctx.fill();
      ctx.font = 'bold 9px "Press Start 2P", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      this._outlinedText(ctx, SLOT_LABEL[f.slot] || '', head.x, head.y - 3, 9, col);
      ctx.restore();
    }
  }

  _drawSmashHUD(ctx, engine) {
    const list = engine.fighterList;
    const n = list.length;
    if (!n) return;
    const gap = 10;
    const panelW = Math.min(200, (this.W - gap * (n + 1)) / n);
    const panelH = 46, y = 8;
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < n; i++) {
      const f = list[i];
      const x = gap + i * (panelW + gap);
      const col = SLOT_COLORS[f.slot] || '#fff';
      const dead = f.eliminated;

      // Cadre
      ctx.globalAlpha = dead ? 0.4 : 1;
      ctx.fillStyle = '#120a24';
      ctx.fillRect(x - 2, y - 2, panelW + 4, panelH + 4);
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.strokeRect(x - 2, y - 2, panelW + 4, panelH + 4);

      // Nom
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = col;
      ctx.textAlign = 'left';
      ctx.fillText(`${SLOT_LABEL[f.slot]} ${f.char.short || f.char.name}`, x + 4, y + 12);

      // Barre de vie
      const barW = panelW - 8, barH = 9, by = y + 17;
      const hpPct = Math.max(0, f.health) / 100;
      ctx.fillStyle = '#4a1220'; ctx.fillRect(x + 4, by, barW, barH);
      let hc = '#3ad14a'; if (hpPct < 0.3) hc = '#ff3a3a'; else if (hpPct < 0.6) hc = '#f5d90a';
      ctx.fillStyle = dead ? '#555' : hc; ctx.fillRect(x + 4, by, barW * hpPct, barH);

      // Vies restantes (petits carrés)
      const sy = by + barH + 5, ss = 7;
      for (let k = 0; k < this.stocksToShow(engine); k++) {
        ctx.fillStyle = k < f.stocks ? col : '#3a2a4a';
        ctx.fillRect(x + 4 + k * (ss + 3), sy, ss, ss);
      }
      if (dead) {
        ctx.fillStyle = '#ff5a5a'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right';
        ctx.fillText('KO', x + panelW - 4, sy + ss);
      }
    }
    ctx.globalAlpha = 1;
  }

  stocksToShow(engine) {
    return engine.stocksMax || 3;
  }

  // ------------------------------------------------------------------
  // Streets of Rage : rue en 2.5D + HUD co-op
  // ------------------------------------------------------------------
  _renderStreets(ctx, engine, cam) {
    ctx.save();
    if (engine.shake > 0.4) { const s = engine.shake; ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s); }

    this._drawCityBg(ctx, cam);
    this._drawStreetGround(ctx, cam);

    const list = (engine.fighterList || []);
    for (const e of list) this._drawStreetShadow(ctx, cam, e);
    const order = list.slice().sort((a, b) => a.pos.y - b.pos.y); // loin -> proche
    for (const f of order) this._drawFighter(ctx, cam, f, engine);

    this._drawProjectiles(ctx, cam, engine);
    this._drawEffects(ctx, cam, engine);

    // Repère "★ FUSION ★" au-dessus du perso fusionné
    const fu = engine.fusion && engine.fusion.active;
    if (fu) {
      const head = this.w2s(cam, fu.x, fu.pos.y + (fu.char.body.h + 26) * fu.scale);
      ctx.save();
      ctx.globalAlpha = 0.7 + Math.sin(this.t * 0.3) * 0.3;
      this._outlinedText(ctx, '★ FUSION ★', head.x, head.y, 10, '#ffd24a');
      ctx.restore();
    }
    ctx.restore();

    if (engine.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${engine.flash / 16})`; ctx.fillRect(0, 0, this.W, this.H); }

    this._drawStreetsHUD(ctx, engine);
    this._drawAnnounce(ctx, engine);
  }

  _drawCityBg(ctx, cam) {
    // Ciel nocturne
    const g = ctx.createLinearGradient(0, 0, 0, this.groundY);
    g.addColorStop(0, '#0b1030'); g.addColorStop(0.6, '#241a46'); g.addColorStop(1, '#3a2450');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    // Lune
    ctx.fillStyle = '#f4e9c1'; ctx.beginPath(); ctx.arc(this.W - 80, 46, 20, 0, Math.PI * 2); ctx.fill();
    // Immeubles en silhouette (2 couches de parallaxe)
    const layer = (speed, base, colH, col) => {
      const off = (-cam.x * cam.zoom * speed);
      ctx.fillStyle = col;
      const bw = 78;
      for (let i = -1; i < this.W / bw + 2; i++) {
        const x = ((i * bw + (off % bw)) );
        const h = base + ((i * 37) % colH);
        ctx.fillRect(x, this.groundY - h, bw - 8, h);
        // fenêtres
        ctx.fillStyle = 'rgba(255,214,90,0.5)';
        for (let wy = this.groundY - h + 10; wy < this.groundY - 12; wy += 18) {
          for (let wx = x + 8; wx < x + bw - 16; wx += 16) if ((wx + wy) % 3 === 0) ctx.fillRect(wx, wy, 6, 8);
        }
        ctx.fillStyle = col;
      }
    };
    layer(0.15, 90, 70, '#160f30');
    layer(0.32, 60, 110, '#20153e');
  }

  _drawStreetGround(ctx, cam) {
    const bandTop = this.groundY - 96 * 0.9 * cam.zoom - 6; // ZMAX * DEPTH_SCALE
    // Trottoir
    ctx.fillStyle = '#2a2036'; ctx.fillRect(0, bandTop - 10, this.W, 12);
    // Chaussée
    ctx.fillStyle = '#3a3340'; ctx.fillRect(0, bandTop, this.W, this.H - bandTop);
    ctx.fillStyle = '#4a4350'; ctx.fillRect(0, bandTop, this.W, 4);
    // Marquage central défilant
    ctx.fillStyle = 'rgba(245,217,10,0.5)';
    const midY = (bandTop + this.H) / 2;
    const step = 60 * cam.zoom; const off = (-cam.x * cam.zoom) % step;
    for (let x = off; x < this.W; x += step) ctx.fillRect(x, midY, 26 * cam.zoom, 4);
  }

  _drawStreetShadow(ctx, cam, e) {
    if (!e || e.dead) return;
    const groundPosY = GROUND_Y - (e.z || 0) * 0.9;
    const s = this.w2s(cam, e.x, groundPosY);
    const w = (e.char.body.w * (e.scale || 1)) * cam.zoom;
    const air = Math.max(0.4, 1 - (e.jumpY || 0) / 90);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 2, w * 0.6 * air, 4.5 * cam.zoom * air, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawStreetsHUD(ctx, engine) {
    const hud = engine.hud; if (!hud) return;
    // Panneaux joueurs (haut gauche, empilés/juxtaposés)
    const pw = 168, ph = 40, gap = 8;
    hud.players.forEach((p, i) => {
      const col = i % 2, row = (i - col) / 2;
      const x = gap + col * (pw + gap);
      const y = gap + row * (ph + gap);
      ctx.globalAlpha = p.dead ? 0.4 : 1;
      ctx.fillStyle = '#120a24'; ctx.fillRect(x - 2, y - 2, pw + 4, ph + 4);
      ctx.strokeStyle = p.fused ? '#ffd24a' : (p.color || '#fff'); ctx.lineWidth = 2; ctx.strokeRect(x - 2, y - 2, pw + 4, ph + 4);
      ctx.font = 'bold 9px monospace'; ctx.fillStyle = p.color || '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (p.fused) {
        ctx.fillStyle = '#ffd24a';
        ctx.fillText(`${p.slot.toUpperCase()} · ${p.role === 'pilote' ? '🕹️ PILOTE' : '👊 FRAPPEUR'}`, x + 4, y + 11);
        ctx.font = '9px monospace'; ctx.fillStyle = '#ffe259';
        ctx.fillText('★ FUSIONNÉ ★', x + 4, y + 30);
      } else {
        ctx.fillText(`${p.slot ? p.slot.toUpperCase() : ''} ${p.name}`, x + 4, y + 11);
        const barW = pw - 8, barH = 8, by = y + 15;
        const hpPct = Math.max(0, p.hp) / p.maxHp;
        ctx.fillStyle = '#4a1220'; ctx.fillRect(x + 4, by, barW, barH);
        let hc = '#3ad14a'; if (hpPct < 0.3) hc = '#ff3a3a'; else if (hpPct < 0.6) hc = '#f5d90a';
        ctx.fillStyle = p.dead ? '#555' : hc; ctx.fillRect(x + 4, by, barW * hpPct, barH);
        const sy = by + barH + 4;
        ctx.font = '9px monospace'; ctx.fillStyle = p.color || '#fff';
        ctx.fillText(p.dead ? '☠️ GAME OVER' : '♥ '.repeat(Math.max(0, p.lives)) || '—', x + 4, sy + 7);
      }
    });
    ctx.globalAlpha = 1;

    // Jauge / barre de FUSION (bas de l'écran)
    this._drawFusionBar(ctx, engine, hud);

    // Barre de vie du boss
    if (hud.boss) {
      const b = hud.boss; const bw = Math.min(360, this.W * 0.5); const bx = (this.W - bw) / 2; const byy = this.H - 30;
      ctx.fillStyle = '#120a24'; ctx.fillRect(bx - 3, byy - 3, bw + 6, 18);
      ctx.fillStyle = '#4a1220'; ctx.fillRect(bx, byy, bw, 12);
      ctx.fillStyle = '#ff3a3a'; ctx.fillRect(bx, byy, bw * Math.max(0, b.hp) / b.maxHp, 12);
      ctx.strokeStyle = '#f5d90a'; ctx.lineWidth = 2; ctx.strokeRect(bx, byy, bw, 12);
      ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText('BOSS · ' + (b.char.name || '').toUpperCase(), this.W / 2, byy - 5);
    } else {
      // Compteur d'ennemis restants
      ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#f5d90a'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      const left = hud.enemies + hud.queue;
      if (left > 0 && engine.phase === 'play') ctx.fillText('ENNEMIS : ' + left, this.W - 12, 12);
    }
  }

  _drawFusionBar(ctx, engine, hud) {
    const f = hud.fusion; if (!f) return;
    const w = Math.min(320, this.W * 0.42);
    const x = (this.W - w) / 2;
    ctx.textBaseline = 'alphabetic';
    if (f.active) {
      const y = this.H - 46;
      ctx.fillStyle = '#120a24'; ctx.fillRect(x - 3, y - 3, w + 6, 16);
      ctx.fillStyle = '#4a3a10'; ctx.fillRect(x, y, w, 10);
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#ff5bd0'); g.addColorStop(1, '#4ad6ff');
      ctx.fillStyle = g; ctx.fillRect(x, y, w * Math.max(0, f.hp) / f.maxHp, 10);
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, 10);
      ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#ffd24a'; ctx.textAlign = 'center';
      ctx.fillText('★ FUSION ★  ' + Math.ceil(f.timer / 60) + 's  ·  ⚡ super', this.W / 2, y - 5);
      return;
    }
    const y = this.H - 28;
    const pct = f.gauge / f.max;
    ctx.fillStyle = '#120a24'; ctx.fillRect(x - 3, y - 3, w + 6, 14);
    ctx.fillStyle = '#2a2036'; ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = pct >= 1 ? '#ffd24a' : '#a06ad0'; ctx.fillRect(x, y, w * pct, 8);
    ctx.strokeStyle = '#4a3a6a'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, 8);
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    if (pct >= 1) { ctx.fillStyle = Math.floor(this.t / 8) % 2 ? '#ffd24a' : '#fff'; ctx.fillText('FUSION PRÊTE — collez-vous + ⚡ ENSEMBLE', this.W / 2, y - 4); }
    else { ctx.fillStyle = '#9b8fd0'; ctx.fillText('JAUGE DE FUSION', this.W / 2, y - 4); }
  }

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  _drawHUD(ctx, engine) {
    const p1 = engine.fighters.p1, p2 = engine.fighters.p2;
    if (!p1 || !p2) return;
    this._playerHUD(ctx, p1, 'left', engine.roundsToWin);
    this._playerHUD(ctx, p2, 'right', engine.roundsToWin);

    // Chrono
    ctx.save();
    ctx.font = 'bold 34px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tl = String(engine.timeLeft).padStart(2, '0');
    ctx.fillStyle = '#1a1030';
    ctx.fillRect(this.W / 2 - 34, 8, 68, 40);
    ctx.strokeStyle = '#f5d90a'; ctx.lineWidth = 2;
    ctx.strokeRect(this.W / 2 - 34, 8, 68, 40);
    ctx.fillStyle = engine.timeLeft <= 10 ? '#ff4a4a' : '#f5d90a';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(tl, this.W / 2, 30);
    ctx.restore();
  }

  _playerHUD(ctx, f, side, roundsToWin = 2) {
    const barW = 250, barH = 20, pad = 14;
    const x = side === 'left' ? pad : this.W - pad - barW;
    const y = 14;
    const hpPct = Math.max(0, f.health) / 100;

    // Cadre
    ctx.fillStyle = '#120a24';
    ctx.fillRect(x - 3, y - 3, barW + 6, barH + 6);

    // Vie
    const fillW = barW * hpPct;
    const fx = side === 'left' ? x : x + barW - fillW;
    let col = '#3ad14a';
    if (hpPct < 0.3) col = '#ff3a3a'; else if (hpPct < 0.6) col = '#f5d90a';
    ctx.fillStyle = '#4a1220';
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = col;
    ctx.fillRect(fx, y, fillW, barH);
    // reflet
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(fx, y, fillW, 4);
    ctx.strokeStyle = '#f5d90a'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, barW, barH);

    // Jauge de rage
    const ry = y + barH + 6, rh = 9;
    const aura = f.char.formAura[f.formIndex] || '#8a8a9a';
    ctx.fillStyle = '#120a24';
    ctx.fillRect(x - 2, ry - 2, barW + 4, rh + 4);
    ctx.fillStyle = '#241634';
    ctx.fillRect(x, ry, barW, rh);
    const rPct = f.rage / RAGE_MAX;
    const rw = barW * rPct;
    const rgx = side === 'left' ? x : x + barW - rw;
    // pulsation en furie
    if (f.formIndex >= 2) ctx.globalAlpha = 0.75 + Math.sin(this.t * 0.3) * 0.25;
    ctx.fillStyle = aura;
    ctx.fillRect(rgx, ry, rw, rh);
    ctx.globalAlpha = 1;
    // repères de seuils
    ctx.fillStyle = '#f5d90a';
    for (const th of RAGE_THRESHOLDS) {
      if (th === 0) continue;
      const tx = side === 'left' ? x + barW * (th / RAGE_MAX) : x + barW - barW * (th / RAGE_MAX);
      ctx.fillRect(tx - 1, ry - 1, 2, rh + 2);
    }

    // Nom + forme
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = side === 'left' ? 'left' : 'right';
    const tx = side === 'left' ? x : x + barW;
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(f.char.name.toUpperCase(), tx, ry + rh + 15);
    ctx.font = '9px monospace';
    ctx.fillStyle = aura === '#8a8a9a' ? '#c9c2d6' : aura;
    ctx.fillText(`${f.char.formNames[f.formIndex]}`, tx, ry + rh + 27);

    // Pastilles de rounds gagnés
    for (let i = 0; i < roundsToWin; i++) {
      const cxp = side === 'left' ? x + 6 + i * 16 : x + barW - 6 - i * 16;
      ctx.beginPath();
      ctx.arc(cxp, y - 12, 5, 0, Math.PI * 2);
      ctx.fillStyle = i < f.wins ? '#f5d90a' : '#3a2a4a';
      ctx.fill();
      ctx.strokeStyle = '#120a24'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // ------------------------------------------------------------------
  // Annonces
  // ------------------------------------------------------------------
  _drawAnnounce(ctx, engine) {
    const a = engine.announce;
    if (!a || a.timer <= 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = this.W / 2, cy = engine.phase === 'matchEnd' ? this.H / 2 : this.H * 0.38;

    // pop d'apparition
    const age = a.timerStart ? 1 : 0;
    const size = a.big ? 30 : 18;
    ctx.font = `bold ${size}px "Press Start 2P", monospace`;

    // contour
    this._outlinedText(ctx, a.text, cx, cy, size, a.big ? '#f5d90a' : '#fff');
    if (a.sub) {
      ctx.font = `bold 14px "Press Start 2P", monospace`;
      this._outlinedText(ctx, a.sub, cx, cy + size, 14, '#ff5bd0');
    }
    if (engine.phase === 'matchEnd') {
      ctx.font = `12px monospace`;
      const blink = Math.sin(this.t * 0.15) > -0.3;
      if (blink) this._outlinedText(ctx, 'Appuie sur ⚡ SPÉCIAL pour rejouer', cx, cy + size + 30, 12, '#9be89b');
    }
    ctx.restore();
  }

  _outlinedText(ctx, text, x, y, size, color) {
    ctx.font = ctx.font; // keep
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 5);
    ctx.strokeStyle = '#1a1030';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // Assombrit une couleur hex (#rrggbb) — f = fraction conservée (0..1).
  _shade(hex, f) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return hex;
    const n = parseInt(hex.slice(1, 7), 16);
    const r = Math.round(((n >> 16) & 255) * f);
    const g = Math.round(((n >> 8) & 255) * f);
    const b = Math.round((n & 255) * f);
    return `rgb(${r},${g},${b})`;
  }

  // Compteur de combos (façon arcade)
  _drawCombo(ctx, engine) {
    for (const side of ['left', 'right']) {
      const slot = side === 'left' ? 'p1' : 'p2';
      const c = engine.combo[slot];
      if (!c || c.count < 2) continue;
      const x = side === 'left' ? 96 : this.W - 96;
      const y = 150;
      const pop = Math.min(1, c.timer / 50);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = 22 + pop * 8;
      ctx.font = `bold ${size}px "Press Start 2P", monospace`;
      this._outlinedText(ctx, `${c.count}`, x, y, size, '#ffd24a');
      ctx.font = `bold 10px "Press Start 2P", monospace`;
      this._outlinedText(ctx, 'COMBO', x, y + size * 0.7, 10, '#fff');
      ctx.restore();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }
}
