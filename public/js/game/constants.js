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
  DASH: 'dash',
  HITSTUN: 'hitstun',
  KO: 'ko',
  TRANSFORM: 'transform',
};

// Mécaniques avancées
export const DOUBLE_TAP_FRAMES = 15;   // fenêtre pour le double-appui (dash)
export const DASH_FRAMES = 13;         // durée d'un dash
export const DASH_SPEED = 8.6;         // vitesse d'un dash avant
export const BACKDASH_SPEED = 7.2;     // vitesse d'un dash arrière
export const BACKDASH_INVULN = 7;      // i-frames au début du dash arrière
export const MAX_COMBO_CHAIN = 3;      // nb max de coups enchaînés par cancel
export const GRAB_RANGE = 58;          // portée d'une projection
export const COMBO_DISPLAY_FRAMES = 80; // durée d'affichage du compteur de combo
export const SPECIAL_SALVO = 5;         // nb de spéciaux d'affilée avant recharge
export const SPECIAL_LOCK_FRAMES = 110; // durée de la recharge forcée (~1.8 s)
