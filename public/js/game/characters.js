/**
 * Définition des combattants et de leurs 3 formes de rage.
 *
 * Chaque personnage a un "moveset" de base (coup léger, coup lourd) dont
 * les dégâts/vitesses sont multipliés par la forme actuelle, plus un
 * spécial DIFFÉRENT par forme (0, 1, 2) — c'est ce qui rend la montée en
 * rage vraiment satisfaisante.
 *
 * Toutes les hitboxes sont centrées sur le combattant (repère : centre
 * horizontal, pieds au sol) et exprimées "vers l'avant" (fx), ce qui les
 * rend automatiquement symétriques selon l'orientation.
 *
 *   fx : distance vers l'avant du centre de la boîte
 *   fy : hauteur du centre de la boîte au-dessus des pieds
 *   hw / hh : demi-largeur / demi-hauteur
 */

// --- Formes de rage (communes aux deux persos, thème visuel à part) ---
export const FORMS = [
  { dmgMul: 1.0, speedMul: 1.0, defMul: 1.0, scale: 1.0 },
  { dmgMul: 1.28, speedMul: 1.18, defMul: 0.9, scale: 1.12 },
  { dmgMul: 1.6, speedMul: 1.36, defMul: 0.82, scale: 1.28 },
];

const meregrand = {
  id: 'meregrand',
  name: 'Mère-Grand',
  short: 'MÉMÉ',
  body: { w: 40, h: 82 },
  speed: 2.4,
  accel: 0.7,
  jump: 15,
  weight: 1.0,
  // Palette de base (des touches changent selon la forme dans le renderer)
  palette: {
    skin: '#e8b88a',
    hair: '#e9e9ef',
    cloth: '#7a3ea0', // robe violette
    cloth2: '#5a2b78',
    accent: '#f2c14e', // châle / lunettes dorées
    weapon: '#8a5a2b', // canne
  },
  formNames: ['Mémé Tranquille', 'Mamie Remontée', 'Grand-Mère Loup'],
  formAura: [null, '#ff5bd0', '#ff2b4a'],
  light: {
    name: 'Coup de canne', startup: 4, active: 4, recovery: 8,
    dmg: 6, hitstun: 12, kb: { x: 3, y: -2 },
    box: { fx: 34, fy: 52, hw: 20, hh: 9 },
  },
  heavy: {
    name: 'Sac à main', startup: 8, active: 5, recovery: 17,
    dmg: 12, hitstun: 20, kb: { x: 7, y: -6 },
    box: { fx: 36, fy: 42, hw: 24, hh: 20 },
  },
  // Projection (Garde + Coup au corps-à-corps) : imparable, bat la garde.
  throw: {
    name: 'Croche-patte de Mémé', type: 'grab', startup: 4, active: 2, recovery: 22,
    dmg: 15, hitstun: 42, kb: { x: 11, y: -9 },
  },
  specials: [
    { name: 'Bonbon collant', type: 'projectile', startup: 10, recovery: 20,
      dmg: 8, hitstun: 16, kb: { x: 5, y: -3 },
      proj: { speed: 4.2, w: 12, h: 12, life: 100, color: '#ff8fc7', shape: 'candy' } },
    { name: 'Aiguilles à tricoter', type: 'projectile', startup: 8, recovery: 16,
      dmg: 10, hitstun: 14, kb: { x: 6, y: -2 },
      proj: { speed: 8.5, w: 22, h: 5, life: 80, color: '#cfd6e6', shape: 'needle' } },
    // Furie : super avec armure (encaisse un coup pendant l'armement).
    { name: 'Hurlement du Loup', type: 'projectile', super: true, armor: true,
      startup: 13, recovery: 26, dmg: 20, hitstun: 32, kb: { x: 13, y: -8 },
      proj: { speed: 6, w: 36, h: 66, life: 52, color: '#ff2b4a', shape: 'howl' } },
  ],
};

const padre = {
  id: 'padre',
  name: 'Padre',
  short: 'PADRE',
  body: { w: 42, h: 84 },
  speed: 2.7,
  accel: 0.8,
  jump: 15.5,
  weight: 1.05,
  palette: {
    skin: '#e2a878',
    hair: '#4a3220',
    cloth: '#2f6fb0', // chemise bleue
    cloth2: '#233b52', // pantalon
    accent: '#d8443c', // ceinture / cravate rouge
    weapon: '#3a2a1a', // journal roulé
  },
  formNames: ['Papa Cool', 'Père Sévère', 'El Padre Furioso'],
  formAura: [null, '#4ad6ff', '#ff7a1a'],
  light: {
    name: 'Taloche', startup: 4, active: 3, recovery: 8,
    dmg: 6, hitstun: 12, kb: { x: 3, y: -2 },
    box: { fx: 32, fy: 54, hw: 18, hh: 9 },
  },
  heavy: {
    name: 'Coup de ceinture', startup: 7, active: 5, recovery: 16,
    dmg: 12, hitstun: 18, kb: { x: 6, y: -5 },
    box: { fx: 42, fy: 46, hw: 28, hh: 12 },
  },
  // Projection (Garde + Coup au corps-à-corps) : imparable, bat la garde.
  throw: {
    name: 'Suplex paternel', type: 'grab', startup: 4, active: 2, recovery: 22,
    dmg: 16, hitstun: 42, kb: { x: 12, y: -10 },
  },
  specials: [
    { name: 'Télécommande', type: 'projectile', startup: 9, recovery: 18,
      dmg: 8, hitstun: 14, kb: { x: 5, y: -2 },
      proj: { speed: 6.5, w: 18, h: 11, life: 90, color: '#2b2b33', shape: 'remote' } },
    { name: 'Pantoufle volante', type: 'projectile', startup: 8, recovery: 15,
      dmg: 10, hitstun: 14, kb: { x: 6, y: -3 },
      proj: { speed: 9.5, w: 20, h: 12, life: 78, color: '#7a4a2a', shape: 'slipper' } },
    // Furie : super avec armure (encaisse un coup pendant l'armement).
    { name: 'Barbecue Furioso', type: 'projectile', super: true, armor: true,
      startup: 12, recovery: 24, dmg: 21, hitstun: 28, kb: { x: 12, y: -7 },
      proj: { speed: 5.2, w: 34, h: 44, life: 58, color: '#ff7a1a', shape: 'fire' } },
  ],
};

export const CHARACTERS = { meregrand, padre };
export const CHARACTER_LIST = [meregrand, padre];

export function getCharacter(id) {
  return CHARACTERS[id] || meregrand;
}
