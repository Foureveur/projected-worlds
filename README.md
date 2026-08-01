# ⚔️ RAGE ROYALE — Mère-Grand vs Padre

Un jeu de combat rétro **à deux joueurs**, façon Street Fighter, où **chaque
joueur utilise son iPhone comme manette**. Le twist : chaque personnage a
**trois formes d'évolution** qui se débloquent au fur et à mesure que sa
**jauge de rage** se remplit. Plus ça cogne, plus ça dégénère. 🔥

```
👵 Mère-Grand : Mémé Tranquille  › Mamie Remontée › Grand-Mère Loup
👨 Padre      : Papa Cool        › Père Sévère    › El Padre Furioso
🧟‍♀️ Dark Mémé  : variante sombre (mêmes coups)
🧛 Dark Padre : variante sombre (mêmes coups)
```

**Modes :** 2 joueurs (chacun son iPhone) **ou** 1 joueur **vs CPU** (bouton
« 🤖 Solo vs CPU » sur la manette, ou touche `C` au clavier).

---

## 🎮 Comment ça marche

Il y a **trois écrans** :

1. **L'écran de jeu** — un ordinateur (ou une TV avec un navigateur) qui
   affiche l'arène. Toute la simulation du combat tourne ici, à 60 images/s.
2. **Deux iPhones** — chacun devient une manette tactile. Ils n'envoient que
   les appuis de boutons → latence minimale, gameplay ultra réactif.
3. **Un petit serveur** — relaie les touches entre les manettes et l'écran.

Tout le monde doit être sur **le même réseau WiFi**.

---

## 🚀 Lancer le jeu

```bash
npm install
npm start
```

Puis :

1. Sur l'ordinateur, ouvre **http://localhost:3000** (ou l'adresse LAN
   affichée dans le terminal, du style `http://192.168.x.x:3000`).
2. Un **QR code** et un **code de partie** (4 lettres) apparaissent.
3. Chaque joueur ouvre l'appareil photo de son iPhone et **scanne le QR
   code** (ou va sur l'URL affichée et tape le code). La manette s'ouvre.
4. Chacun **choisit son combattant** puis appuie sur **PRÊT !**.
5. Dès que les deux joueurs sont prêts → **FIGHT !** 🥊

> 💡 Mets ton iPhone en **mode paysage** pour la manette.

---

## 🕹️ Les commandes (sur l'iPhone)

**Main gauche — déplacements**

| Bouton | Action |
|--------|--------|
| ◀ ▶ | Se déplacer |
| ▲ SAUT | Sauter |
| ▼ BAS | S'accroupir |

**Main droite — actions**

| Bouton | Action |
|--------|--------|
| 👊 COUP | Attaque rapide |
| 🦶 PIED | Attaque lourde |
| ⚡ SPÉCIAL | Coup spécial (change selon la forme de rage !) |
| 🛡 GARDE | Se protéger (maintenir) — réduit les dégâts |

**Coups avancés :**

| Commande | Coup |
|----------|------|
| 🛡 GARDE + 👊 COUP (au corps-à-corps) | **Projection** — imparable, bat la garde ! |
| Double ◀◀ ou ▶▶ | **Dash** avant / arrière (le dash arrière esquive) |
| ▼ BAS + 👊/🦶 | Coup **bas** (accroupi) |
| 👊/🦶 en l'air | Coup **sauté** |
| Enchaîner coup léger → lourd → spécial | **Combos** (cancels) |
| ⚡ SPÉCIAL en **furie** | **Super** — gros dégâts + armure (encaisse un coup) |

En fin de match, **⚡ SPÉCIAL** relance une revanche.

🔊 Sur l'écran de jeu, la touche **M** coupe/active le son.
📱 Sur iPhone/iPad : **Partager → « Sur l'écran d'accueil »** installe la
manette comme une vraie app plein écran (PWA).

### ⌨️ Clavier de secours (pour tester sans téléphone)

Tu peux jouer à deux sur un seul clavier :

- **Joueur 1** : `A`/`D` se déplacer, `W` sauter, `S` s'accroupir,
  `F` coup, `G` pied, `H` spécial, `V` garde.
- **Joueur 2** : `←`/`→`, `↑` sauter, `↓` s'accroupir,
  `J` coup, `K` pied, `L` spécial, `N` garde.

Appuie sur une touche pour démarrer directement.

---

## 🔥 Le système de rage

Chaque combattant a une **jauge de rage** (sous sa barre de vie). Elle se
remplit quand il **encaisse** des coups (beaucoup) et quand il en **donne**
(un peu). À chaque **palier franchi**, il **se transforme** :

| Forme | Seuil de rage | Ce qui change |
|-------|---------------|---------------|
| **Forme 1** | 0 % | Stats de base |
| **Forme 2** | 40 % | Plus rapide, plus fort, nouvelle aura, nouveau spécial |
| **Forme 3** (furie) | 75 % | Vitesse et dégâts max, yeux rouges, spécial dévastateur |

Une transformation offre un **bref moment d'invincibilité**, un **petit soin**
et une **onde de choc** qui repousse l'adversaire. Récompense de l'agressivité !

Chaque forme a **son propre coup spécial** :

- **Mère-Grand** : Bonbon collant → Aiguilles à tricoter → **Hurlement du Loup**
- **Padre** : Télécommande → Pantoufle volante → **Barbecue Furioso**

---

## 🛠️ La tech

Webapp, zéro installation côté joueurs. 100 % autonome (aucune image ni
police obligatoire : personnages, décor et sons sont **générés en code**).

| Partie | Techno |
|--------|--------|
| Serveur / relais | Node.js + Express + `ws` (WebSocket) |
| QR code | `qrcode` (généré à la volée) |
| Rendu du jeu | Canvas 2D en pixel-art procédural |
| Boucle de jeu | Pas fixe 60 Hz (déterministe) |
| Son | Web Audio API : bruitages 8-bit **et** musique chiptune, tout généré en code (intensité qui monte avec la rage) |
| Manette | HTML/CSS/JS, multitouch natif, vibrations |

### Pourquoi c'est réactif

- La simulation tourne **entièrement sur l'écran de jeu**. Les manettes
  n'envoient que des événements `bouton pressé / relâché`, à l'instant précis
  du toucher (pas de scrutation régulière).
- Sur un réseau local, l'aller-retour WebSocket est de quelques millisecondes.
- Un **petit tampon d'entrée** (input buffer) rend les enchaînements
  tolérants même en fin d'animation.
- **Hit-stop** et **secousses d'écran** donnent du poids aux impacts.

### Structure du projet

```
server.js                     # relais WebSocket + fichiers statiques + QR
public/
  index.html                  # écran de jeu (l'arène)
  controller.html             # la manette (iPhone)
  css/                        # styles écran + manette
  js/
    game/
      constants.js            # physique & réglages
      characters.js           # persos + 3 formes de rage + movesets
      fighter.js              # physique + machine à états d'un combattant
      engine.js               # moteur : collisions, rounds, caméra, effets
      renderer.js             # rendu pixel-art procédural
      audio.js                # synthé de bruitages rétro
      main.js                 # réseau, salon, boucle de jeu (écran)
    controller/
      controller.js           # multitouch, réseau, HUD (manette)
```

---

## 🧰 Réglages utiles

- **Changer le port** : `PORT=8080 npm start`
- **Meilleur des combien de rounds ?** → `ROUNDS_TO_WIN` dans
  `public/js/game/constants.js`
- **Durée d'un round, seuils de rage, gravité, vitesses…** → tout est
  centralisé dans `constants.js` et `characters.js`.

## ❓ Dépannage

- **Le téléphone ne se connecte pas** → vérifie que l'iPhone et l'ordinateur
  sont sur le **même WiFi**, et utilise bien l'**adresse LAN** (pas
  `localhost`) affichée au démarrage.
- **« Room introuvable »** → l'écran de jeu doit rester ouvert ; recharge-le
  pour générer un nouveau code.
- **Pas de son** → clique une fois sur la fenêtre de l'écran de jeu (les
  navigateurs bloquent l'audio tant qu'il n'y a pas d'interaction).

Amuse-toi bien, et que la meilleure rage gagne ! 👵⚔️👨
