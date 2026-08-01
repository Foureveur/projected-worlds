/**
 * Constantes globales du jeu.
 * Tout est en "unités monde" = pixels de la résolution interne rétro.
 */

// Résolution interne (16:9). On la rend en gros avec image-rendering: pixelated
// pour un rendu bien rétro, quelle que soit la taille de l'écran.
export const VIEW_W = 640;
export const VIEW_H = 360;

// Le stage est plus large que l'écran : la caméra suit et dézoome pour
// garder les deux combattants à l'image.
export const STAGE_W = 1120;
export const GROUND_Y = 300; // hauteur du sol en unités monde

// Physique
export const GRAVITY = 0.9;
export const MAX_FALL = 20;
export const FRICTION_GROUND = 0.78;
export const FRICTION_AIR = 0.96;

// La simulation tourne à pas fixe (60 Hz) pour un feel constant.
export const TICK_MS = 1000 / 60;

// Rage : de 0 à 100. Deux seuils => 3 formes (0, 1, 2).
export const RAGE_MAX = 100;
export const RAGE_THRESHOLDS = [0, 40, 75]; // forme 0 dès 0, forme 1 à 40, forme 2 à 75

// Combat
export const START_HEALTH = 100;
export const ROUND_TIME = 60; // secondes
export const ROUNDS_TO_WIN = 2; // best of 3

// Boutons envoyés par la manette
export const BUTTONS = ['left', 'right', 'up', 'down', 'punch', 'kick', 'special', 'block'];

// États d'un combattant
export const STATE = {
  IDLE: 'idle',
  WALK: 'walk',
  JUMP: 'jump',
  CROUCH: 'crouch',
  BLOCK: 'block',
  ATTACK: 'attack',
  HITSTUN: 'hitstun',
  KO: 'ko',
  TRANSFORM: 'transform',
};
