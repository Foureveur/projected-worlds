# 🚀 Déploiement de Rage Royale

Rage Royale est un **serveur Node.js persistant avec WebSocket** (ce n'est
pas un site statique). Il lui faut donc un hébergement qui garde un process
Node en vie : un VPS classique est parfait. Les plateformes 100 % serverless
(ex. Vercel) ne conviennent pas au relais WebSocket tel quel.

> ⚠️ **Point clé** : en prod, définis la variable **`PUBLIC_URL`** avec le
> domaine public (ex. `https://jeu.partiqle.studio`). C'est ce que le jeu met
> dans le **QR code** et le lien de partage. Sans ça, il retombe sur les
> en-têtes de la requête, puis sur l'IP locale — ce qui ne marche pas depuis
> un téléphone en 4G.

Un **nom de domaine + HTTPS** est fortement recommandé : l'appareil photo des
iPhones ouvre plus volontiers les liens `https`, et certaines API navigateur
(vibration incluse) sont plus fiables en contexte sécurisé.

---

## Option A — Docker (recommandé)

Sur le VPS :

```bash
git clone <url-du-repo> rage-royale && cd rage-royale

# Domaine public utilisé dans le QR code
echo "PUBLIC_URL=https://jeu.partiqle.studio" > .env

docker compose up -d --build
```

Le jeu écoute alors sur `127.0.0.1:3000`. Il reste à brancher un reverse
proxy + HTTPS (voir plus bas).

Mise à jour ultérieure :

```bash
git pull && docker compose up -d --build
```

Logs : `docker compose logs -f`

---

## Option B — Node + PM2 (sans Docker)

```bash
git clone <url-du-repo> rage-royale && cd rage-royale
npm ci --omit=dev

npm i -g pm2
PUBLIC_URL=https://jeu.partiqle.studio PORT=3000 pm2 start server.js --name rage-royale
pm2 save && pm2 startup   # redémarre au boot du serveur
```

Mise à jour : `git pull && pm2 restart rage-royale`

### Variante systemd (au lieu de PM2)

`/etc/systemd/system/rage-royale.service` :

```ini
[Unit]
Description=Rage Royale
After=network.target

[Service]
WorkingDirectory=/opt/rage-royale
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
Environment=PUBLIC_URL=https://jeu.partiqle.studio
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rage-royale
```

---

## Reverse proxy + HTTPS

Le WebSocket a besoin des en-têtes d'`Upgrade`. **N'oublie pas cette partie.**

### nginx

```nginx
server {
    listen 80;
    server_name jeu.partiqle.studio;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # --- indispensable pour le WebSocket ---
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # --- pour que le QR code utilise le bon domaine/protocole ---
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        proxy_read_timeout 3600s; # garde les WebSockets ouverts
    }
}
```

Puis HTTPS gratuit avec Certbot :

```bash
sudo certbot --nginx -d jeu.partiqle.studio
```

### Caddy (HTTPS automatique, encore plus simple)

`Caddyfile` :

```
jeu.partiqle.studio {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy gère le WebSocket et le certificat TLS tout seul.

---

## Checklist finale

1. `jeu.partiqle.studio` pointe (DNS type A) vers l'IP du VPS.
2. Le service tourne (`docker compose ps` ou `pm2 status`).
3. `PUBLIC_URL` = ton domaine `https://…`.
4. Reverse proxy avec en-têtes `Upgrade`/`Connection` + `X-Forwarded-*`.
5. HTTPS actif.
6. Test : ouvre `https://jeu.partiqle.studio` → le QR doit pointer vers ce
   domaine, et deux téléphones (même en 4G) doivent pouvoir rejoindre.

`GET /healthz` renvoie `{"ok":true}` pour le monitoring.
