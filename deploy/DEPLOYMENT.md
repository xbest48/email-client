# Deployment PM2

Ce projet se déploie le plus simplement avec deux dossiers séparés sur le
serveur :

```text
/home/applications/kymamail/
  frontend/
    current/                 # contenu de dist/email-client/browser
  backend/
    current/
      dist/                  # build NestJS
      package.json
      package-lock.json
      .env
      node_modules/
      ecosystem.config.cjs
```

La base SQLite ne doit pas vivre dans le dossier de release. Utilise un chemin
persistant, par exemple :

```text
/home/kyma-mail/settings.sqlite
```

et configure `DB_PATH=/home/kyma-mail/settings.sqlite` dans le fichier
`.env` du backend.

## Points importants

- Le frontend Angular est statique : on déploie seulement le contenu de
  `dist/email-client/browser`.
- Le backend NestJS est une application Node.js compilée : on déploie
  `dist/` + `package.json` + `package-lock.json` + `.env`, puis on exécute
  `npm ci --omit=dev` sur le serveur.
- PM2 doit rester en `fork` avec `instances: 1`.
  Ce backend utilise SQLite et conserve aussi certains états temporaires en
  mémoire pour l'authentification. Le mode `cluster` casserait ce
  comportement.

## 1. Build local

Depuis la racine du projet :

```bash
npm run build
npm --prefix nest-backend run build
```

Le frontend produit :

```text
dist/email-client/browser
```

Le backend produit :

```text
nest-backend/dist
```

## 2. Préparer le serveur

```bash
sudo mkdir -p /home/applications/kymamail/frontend/current
sudo mkdir -p /home/applications/kymamail/backend/current
sudo mkdir -p /home/kyma-mail

sudo chown -R $USER:$USER /home/applications/kymamail
sudo chown -R $USER:$USER /home/kyma-mail
```

## 3. Copier les fichiers

Exemple avec `rsync` :

### Frontend

```bash
rsync -av --delete \
  dist/email-client/browser/ \
  user@server:/home/applications/kymamail/frontend/current/
```

### Backend

```bash
rsync -av --delete \
  nest-backend/dist/ \
  user@server:/home/applications/kymamail/backend/current/dist/

rsync -av \
  nest-backend/package.json \
  nest-backend/package-lock.json \
  deploy/pm2/ecosystem.config.cjs \
  user@server:/home/applications/kymamail/backend/current/

scp nest-backend/.env \
  user@server:/home/applications/kymamail/backend/current/.env
```

Si tu préfères `scp` seulement :

```bash
scp -r dist/email-client/browser/* user@server:/home/applications/kymamail/frontend/current/
scp -r nest-backend/dist user@server:/home/applications/kymamail/backend/current/
scp nest-backend/package.json nest-backend/package-lock.json deploy/pm2/ecosystem.config.cjs user@server:/home/applications/kymamail/backend/current/
scp nest-backend/.env user@server:/home/applications/kymamail/backend/current/.env
```

## 4. Installer les dépendances backend

Sur le serveur :

```bash
cd /home/applications/kymamail/backend/current
npm ci --omit=dev
```

## 5. Démarrer ou recharger avec PM2

Le fichier fourni est :

```text
deploy/pm2/ecosystem.config.cjs
```

Important :

- le port du backend doit etre defini dans le fichier `.env` du backend ;
- `ecosystem.config.cjs` ne doit pas forcer `PORT`, sinon PM2 ecrase la valeur
  du `.env`.

Sur le serveur :

```bash
cd /home/applications/kymamail/backend/current
pm2 start ecosystem.config.cjs --env production
```

Pour un redéploiement :

```bash
cd /home/applications/kymamail/backend/current
pm2 reload ecosystem.config.cjs --env production --update-env
```

Pour sauvegarder l'état PM2 :

```bash
pm2 save
```

Vérifications utiles :

```bash
pm2 status
pm2 logs kyma-mail-backend
```

## 6. Activer Nginx

La configuration fournie est :

```text
deploy/nginx/kyma-mail.conf
```

Elle suppose :

- domaine frontend : `https://mail.example.com`
- frontend servi depuis `/home/applications/kymamail/frontend/current`
- backend NestJS disponible localement sur `127.0.0.1:3300`

Installation typique :

```bash
sudo cp deploy/nginx/kyma-mail.conf /etc/nginx/sites-available/kyma-mail.conf
sudo ln -s /etc/nginx/sites-available/kyma-mail.conf /etc/nginx/sites-enabled/kyma-mail.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Checklist production

- Remplacer `mail.example.com` et `example.com` par le vrai domaine.
- Copier un vrai `.env` prod basé sur
  `nest-backend/.env.production.example`.
- Générer `ENCRYPTION_KEY`, `JWT_SECRET` et `JWT_REFRESH_SECRET`.
- Vérifier que `CORS_ORIGINS` et `WEBAUTHN_ORIGINS` pointent vers l'URL HTTPS
  réelle.
- Vérifier que `WEBAUTHN_RP_ID` contient bien le domaine registrable.
- Vérifier que `DB_PATH` pointe vers un chemin persistant.
- Installer les certificats TLS avant l'activation finale de Nginx.
