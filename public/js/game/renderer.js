/**
 * Renderer — dessine tout le jeu en pixel-art procédural (aucune image à
 * charger). On rend dans un buffer VIEW_W x VIEW_H puis on l'agrandit en
 * CSS avec image-rendering: pixelated => rendu bien rétro et net.
 *
 * Repère "local" d'un combattant : origine aux pieds, +x vers l'avant
 * (selon l'orientation), +y vers le haut. On transforme local -> monde
 * -> écran via la caméra.
 */

import { VIEW_W, VIEW_H, STAGE_W, GROUND_Y, STATE, RAGE_MAX, RAGE_THRESHOLDS, ROUNDS_TO_WIN, ROUND_TIME } from './constants.js';

const GROUND_SCREEN_Y = Math.round(VIEW_H * 0.86);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.t = 0;
  }

  // monde -> écran
  w2s(cam, wx, wy) {
    return {
      x: (wx - cam.x) * cam.zoom,
      y: GROUND_SCREEN_Y - (GROUND_Y - wy) * cam.zoom,
    };
  }

  render(engine) {
    this.t++;
    const ctx = this.ctx;
    const cam = engine.camera;

    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    // Avant la configuration (salon), on dessine juste le décor.
    if (!engine.fighters.p1 || !engine.fighters.p2) {
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

    // Ombres
    for (const slot of ['p1', 'p2']) this._drawShadow(ctx, cam, engine.fighters[slot]);

    // Combattants (le plus en retrait dessiné d'abord)
    const order = [engine.fighters.p1, engine.fighters.p2].sort((a, b) => a.pos.y - b.pos.y);
    for (const f of order) this._drawFighter(ctx, cam, f, engine);

    this._drawProjectiles(ctx, cam, engine);
    this._drawEffects(ctx, cam, engine);

    ctx.restore();

    // Flash plein écran
    if (engine.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${engine.flash / 16})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    this._drawHUD(ctx, engine);
    this._drawAnnounce(ctx, engine);
  }

  // ------------------------------------------------------------------
  // Décor : salon de Mère-Grand, ambiance crépuscule
  // ------------------------------------------------------------------
  _drawBackground(ctx, cam) {
    // Mur en dégradé
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_SCREEN_Y);
    g.addColorStop(0, '#3a2350');
    g.addColorStop(0.55, '#5a2f5e');
    g.addColorStop(1, '#7a3f55');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, GROUND_SCREEN_Y + 2);

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

    // Cadres photo
    const px2 = -cam.x * cam.zoom * 0.5;
    this._frame(ctx, px2 + 300, 40, 40, 52, '#c9a24b', '#7a3ea0');
    this._frame(ctx, px2 + 360, 60, 34, 40, '#c9a24b', '#2f6fb0');
    this._frame(ctx, px2 + 520, 46, 44, 54, '#c9a24b', '#3a7a4a');

    // Étagère
    ctx.fillStyle = '#4a2f22';
    ctx.fillRect(px2 + 700, 120, 160, 8);
  }

  _frame(ctx, x, y, w, h, border, inner) {
    ctx.fillStyle = border;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = inner;
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  }

  _drawGround(ctx, cam) {
    // Tapis / plancher
    ctx.fillStyle = '#3a231c';
    ctx.fillRect(0, GROUND_SCREEN_Y, VIEW_W, VIEW_H - GROUND_SCREEN_Y);
    ctx.fillStyle = '#4d2f24';
    ctx.fillRect(0, GROUND_SCREEN_Y, VIEW_W, 5);
    // Lattes de parquet
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    const step = 46 * cam.zoom;
    const off = (-cam.x * cam.zoom) % step;
    for (let x = off; x < VIEW_W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_SCREEN_Y + 6);
      ctx.lineTo(x, VIEW_H);
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
    ctx.ellipse(s.x, GROUND_SCREEN_Y + 2, (w * 0.7) * airFactor, 5 * cam.zoom * airFactor, 0, 0, Math.PI * 2);
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

    // Anim de base
    const t = f.animTime;
    let bob = 0, lean = 0, legPhase = 0, crouch = 0, armExtend = 0, koRot = 0, tuck = 0;

    if (f.state === STATE.WALK) { legPhase = Math.sin(t * 0.35); bob = Math.abs(Math.sin(t * 0.35)) * 2; }
    else if (f.state === STATE.IDLE || f.state === STATE.BLOCK) { bob = Math.sin(t * 0.08) * 1.2; }
    else if (f.state === STATE.JUMP) { tuck = 1; }
    else if (f.state === STATE.CROUCH) { crouch = 1; }
    else if (f.state === STATE.HITSTUN) { lean = -0.35; }
    else if (f.state === STATE.KO) { koRot = 1; }

    // Extension du bras pendant la phase active d'une attaque
    if (f.attack) {
      const ph = f.attack.phase;
      if (ph === 'active') armExtend = 1;
      else if (ph === 'startup') armExtend = 0.4;
      else armExtend = 0.5;
    }

    // Aura de rage (derrière le perso)
    if (aura) this._drawAura(ctx, cam, f, aura, S);

    // Position des pieds (origine locale)
    const feet = this.w2s(cam, f.pos.x, f.pos.y);
    const face = f.facing;

    // Helper : dessine un rectangle en coords locales (cx avant, cy haut)
    const part = (cxL, cyL, w, h, color, r = 0) => {
      const sx = feet.x + face * cxL * S;
      const sy = feet.y - cyL * S;
      const pw = w * S, ph = h * S;
      ctx.fillStyle = color;
      if (r > 0) this._roundRect(ctx, sx - pw / 2, sy - ph / 2, pw, ph, r * S);
      else ctx.fillRect(Math.round(sx - pw / 2), Math.round(sy - ph / 2), Math.ceil(pw), Math.ceil(ph));
    };

    // Clignotement blanc quand touché
    const flashing = f.hitFlash > 0 && (f.hitFlash % 2 === 0);
    const skin = flashing ? '#ffffff' : pal.skin;
    const cloth = flashing ? '#ffffff' : pal.cloth;
    const cloth2 = flashing ? '#ffffff' : pal.cloth2;
    const hair = flashing ? '#ffffff' : pal.hair;

    if (koRot) {
      // Perso au sol
      ctx.save();
      ctx.translate(feet.x, feet.y);
      ctx.rotate(face * -Math.PI / 2.1);
      ctx.fillStyle = cloth;
      ctx.fillRect(-14 * S, -34 * S, 28 * S, 40 * S);
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(0, -44 * S, 11 * S, 0, Math.PI * 2); ctx.fill();
      // yeux en croix
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

    const yScale = crouch ? 0.62 : 1;
    const legTop = 30 * yScale;
    const bodyTop = 58 * yScale;
    const headY = (68 * yScale) + bob;

    // Jambes
    const legSwing = legPhase * 6;
    part(-6 + (tuck ? 4 : 0), (legTop / 2) + bob, 9, legTop, cloth2); // jambe arrière
    part(6 - legSwing * 0.0, (legTop / 2) + bob, 9, legTop, cloth2);  // jambe avant
    if (f.state === STATE.WALK) {
      part(-6 - legSwing, (legTop / 2) + bob, 9, legTop, cloth2);
      part(6 + legSwing, (legTop / 2) + bob, 9, legTop, cloth2);
    }
    // Pieds
    part(-6, 3 + bob, 12, 6, '#2a1a12');
    part(8, 3 + bob, 12, 6, '#2a1a12');

    // Corps / robe
    if (f.char.id === 'meregrand') {
      // Robe trapèze
      const by = (legTop + (bodyTop - legTop) / 2) + bob;
      part(0, by, 34, bodyTop - legTop, cloth);
      part(0, legTop + 2 + bob, 40, 8, cloth); // ourlet
      part(0, bodyTop - 4 + bob, 30, 8, pal.accent); // châle
    } else {
      const by = (legTop + (bodyTop - legTop) / 2) + bob;
      part(0, by, 30, bodyTop - legTop, cloth); // chemise
      part(0, legTop + 6 + bob, 30, 14, cloth2); // ceinture pantalon
      part(2, by, 5, bodyTop - legTop - 6, pal.accent); // cravate
    }

    // Bras arrière
    part(-10, bodyTop - 8 + bob - lean * 10, 8, 20, skin);

    // Tête
    part(0, headY, 22, 22, skin, 6);
    // Cheveux
    if (f.char.id === 'meregrand') {
      part(0, headY + 9, 26, 12, hair, 5); // chignon large
      part(0, headY + 15, 12, 10, hair, 4);
      // Lunettes
      part(4, headY + 1, 16, 6, pal.accent);
    } else {
      part(-2, headY + 10, 24, 8, hair, 3); // cheveux courts
      part(0, headY - 8, 18, 6, '#5a4030'); // moustache/menton
    }

    // Yeux (rouges et brillants en furie)
    const eyeColor = f.formIndex >= 2 ? '#ff2b2b' : '#222';
    part(5, headY + 2, 4, 4, eyeColor);
    if (f.formIndex >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(this.t * 0.3) * 0.3;
      part(5, headY + 2, 7, 7, '#ff5a5a');
      ctx.restore();
    }

    // Bras avant + arme (s'étend pendant l'attaque)
    const reach = armExtend * 22;
    const armY = bodyTop - 8 + bob - lean * 10;
    part(12 + reach * 0.5, armY, 10, 8, skin); // bras
    this._drawWeapon(ctx, part, f, 20 + reach, armY, armExtend);

    // Bras de garde
    if (f.state === STATE.BLOCK) {
      part(14, bodyTop - 2 + bob, 10, 26, skin);
      ctx.save();
      ctx.globalAlpha = 0.4 + (f.blockFlash > 0 ? 0.4 : 0);
      part(20, bodyTop - 4 + bob, 8, 34, '#8fd6ff');
      ctx.restore();
    }
  }

  _drawWeapon(ctx, part, f, x, y, extend) {
    const id = f.char.id;
    const pal = f.char.palette;
    if (f.attack && f.attack.kind === 'special') {
      // pas d'arme visible sur les spéciaux (projectile)
      return;
    }
    if (id === 'meregrand') {
      // Canne
      part(x, y - 6, 6, 34, pal.weapon);
      part(x + 2, y + 8, 12, 6, pal.weapon); // poignée
    } else {
      // Journal roulé / ceinture
      if (f.attack && f.attack.kind === 'heavy') {
        part(x + 4, y, 30, 6, pal.accent); // ceinture longue
      } else {
        part(x, y, 16, 8, pal.weapon);
      }
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
  // HUD
  // ------------------------------------------------------------------
  _drawHUD(ctx, engine) {
    const p1 = engine.fighters.p1, p2 = engine.fighters.p2;
    if (!p1 || !p2) return;
    this._playerHUD(ctx, p1, 'left');
    this._playerHUD(ctx, p2, 'right');

    // Chrono
    ctx.save();
    ctx.font = 'bold 34px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tl = String(engine.timeLeft).padStart(2, '0');
    ctx.fillStyle = '#1a1030';
    ctx.fillRect(VIEW_W / 2 - 34, 8, 68, 40);
    ctx.strokeStyle = '#f5d90a'; ctx.lineWidth = 2;
    ctx.strokeRect(VIEW_W / 2 - 34, 8, 68, 40);
    ctx.fillStyle = engine.timeLeft <= 10 ? '#ff4a4a' : '#f5d90a';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(tl, VIEW_W / 2, 30);
    ctx.restore();
  }

  _playerHUD(ctx, f, side) {
    const barW = 250, barH = 20, pad = 14;
    const x = side === 'left' ? pad : VIEW_W - pad - barW;
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
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
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
    const cx = VIEW_W / 2, cy = engine.phase === 'matchEnd' ? VIEW_H / 2 : VIEW_H * 0.38;

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
