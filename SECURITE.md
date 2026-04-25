# Securites mises en place

Derniere mise a jour : 2026-04-25

Ce fichier sert de memo des protections deja presentes dans l'application. Il ne liste que les mesures implementees dans le code du projet.

## Authentification

- Les mots de passe utilisateurs sont haches avec `bcrypt`, avec un nombre de tours configurable par `BCRYPT_ROUNDS` et une valeur par defaut de `12`.
- L'inscription impose un mot de passe de `10` a `128` caracteres, avec au moins une lettre et un chiffre.
- La connexion evite l'enumeration d'utilisateurs en executant une comparaison `bcrypt` factice quand l'adresse email n'existe pas.
- Les secrets JWT sont obligatoires en production via `JWT_SECRET` et `JWT_REFRESH_SECRET`.
- Les access tokens JWT sont courts, avec une duree de vie de `15 minutes`.
- Les refresh tokens sont signes avec un secret dedie et stockes cote serveur sous forme de hash `bcrypt`.
- Les refresh tokens sont lies a une session serveur persistante, avec expiration, revocation et rotation a chaque rafraichissement.
- La reutilisation d'un ancien refresh token provoque la revocation de la session concernee.
- Les routes protegees refusent les tokens temporaires 2FA et les tokens qui ne sont pas des access tokens normaux.
- Le backend maintient une liste de sessions actives par utilisateur et permet de revoquer une session precise ou toutes les autres sessions.

## Cookies Et Sessions

- Le refresh token est stocke dans un cookie `httpOnly`, inaccessible au JavaScript du navigateur.
- Le cookie de refresh utilise `sameSite: strict`, ce qui limite les attaques CSRF sur les routes de refresh.
- Le cookie de refresh utilise `secure` en production.
- Le cookie de refresh est limite au chemin `/api/auth`.
- Le backend fait confiance a un seul saut de reverse proxy avec `trust proxy = 1`, pour eviter de traiter aveuglement des chaines de proxy arbitraires.
- Les informations de session sensibles comme l'IP et le User-Agent sont chiffrees au repos.

## Double Facteur Et Passkeys

- La 2FA TOTP est disponible avec generation d'un secret et d'un QR code.
- Les codes TOTP deja acceptes sont memorises temporairement pour empecher leur reutilisation pendant la meme fenetre de temps.
- Les tokens temporaires utilises pendant la 2FA expirent rapidement et sont consommes une seule fois.
- Les passkeys WebAuthn sont prises en charge pour l'enregistrement et la connexion.
- En production, WebAuthn exige un `RP_ID` non-localhost et des origins en `https://`.
- Les challenges WebAuthn sont verifies cote backend avec `expectedChallenge`, `expectedOrigin` et `expectedRPID`.
- Les compteurs WebAuthn sont mis a jour apres verification reussie.
- Les credentials WebAuthn existants sont exclus lors de l'enregistrement d'un nouveau passkey pour eviter les doublons.

## Controle D'Acces Backend

- Les routes applicatives sensibles utilisent `JwtAuthGuard`.
- Les donnees metier sont filtrees par `userId` cote backend : comptes, parametres, libelles, contacts, filtres, snoozes, messages programmes, cles PGP et analyses IA.
- Les routes de comptes email exigent l'en-tete `x-account-id` et verifient que le compte appartient a l'utilisateur connecte.
- Les actions sur les libelles, filtres, snoozes et emails programmes verifient l'appartenance utilisateur avant lecture, modification ou suppression.
- Les parametres applicatifs serveur retirent explicitement les comptes email du blob libre `appSettings`, car les comptes sont geres par leur propre table.

## Validation Et Limites

- Le backend utilise un `ValidationPipe` global avec `whitelist`, `forbidNonWhitelisted` et `transform`.
- En production, les details internes des erreurs de validation sont masques.
- Les endpoints d'authentification sensibles utilisent du rate limiting via `@nestjs/throttler`.
- Le backend applique une limite de `25 MB` aux corps JSON et URL-encoded.
- Les uploads de pieces jointes sont limites a `20` fichiers et `25 MB` par fichier.
- L'envoi SMTP limite le nombre de destinataires a `100`.
- Les valeurs placees dans les en-tetes SMTP sont filtrees contre les injections CRLF.
- Les cles API IA sont limitees en longueur avant chiffrement et sauvegarde.
- Les cles PGP importees sont validees par longueur et par presence des en-tetes/fins d'armure attendus.

## Chiffrement Au Repos

- Les secrets applicatifs sensibles utilisent AES-256-GCM avec authentification.
- `ENCRYPTION_KEY` est obligatoire pour chiffrer et dechiffrer les donnees sensibles.
- Les anciens chiffrements AES-256-CBC peuvent etre relus avec `LEGACY_ENCRYPTION_KEY` pour permettre une migration controlee.
- Les mots de passe IMAP/SMTP des comptes email sont chiffres au repos.
- Les cles API IA sont chiffrees au repos.
- Les cles privees PGP sont chiffrees au repos.
- Les parametres synchronises contenant signatures, modeles et preferences sont chiffres au repos.
- Les comptes email chiffrent aussi l'adresse du compte, le nom affiche et les hotes IMAP/SMTP.
- Les contacts sauvegardes chiffrent les noms et adresses email.
- Les noms de libelles sont chiffres au repos.
- Les filtres chiffrent leur nom, leur valeur de condition et leur valeur d'action.
- Les emails programmes chiffrent destinataires, sujet et corps.
- Les cles publiques PGP stockees cote serveur et les cles de contacts PGP sont chiffrees au repos.
- Les informations d'analyse IA stockees en base chiffrent la categorie et la raison.
- Un script de migration `npm run encrypt:existing-data` chiffre les donnees existantes deja presentes dans la base.

## Email Et Messagerie

- Les connexions IMAP utilisent TLS via `secure: true`.
- Les connexions SMTP utilisent TLS par defaut, avec STARTTLS pour le port `587`.
- Les certificats SMTP invalides sont refuses par defaut.
- Les images externes des emails peuvent etre bloquees selon la politique utilisateur.
- Les domaines d'images explicitement autorises ou bloques sont geres par utilisateur.
- Les liens dans le rendu HTML des emails qui s'ouvrent dans un nouvel onglet recoivent `rel="noopener noreferrer"`.
- Les images base64 trop lourdes dans les signatures sont bloquees avant sauvegarde.
- Les images base64 integrees dans les signatures sont limitees a `180 Ko` par image.
- Les analyses IA de phishing sont mises en cache par utilisateur, compte et message pour eviter des appels repetes sur le meme contenu.

## Intelligence Artificielle

- Les cles API IA sont chiffrees avant stockage.
- Les appels IA sont executes cote backend, ce qui evite d'exposer les cles API IA au navigateur.
- Les fonctionnalites IA sont protegees par utilisateur et par interrupteur : redaction, resume, suggestions, actions, phishing, categorisation, traduction et tri intelligent.
- Le backend refuse une fonctionnalite IA desactivee pour l'utilisateur, meme si le frontend tente d'appeler directement l'API.
- Les resultats d'analyse IA sont separes par utilisateur et par compte email.
- Les contenus cites dans les reponses sont retires avant l'analyse phishing, afin de concentrer l'analyse sur le dernier message recu.

## Frontend

- Les routes protegees attendent la fin de l'initialisation d'authentification avant de laisser entrer l'utilisateur.
- L'intercepteur HTTP ajoute le bearer token uniquement aux routes non publiques.
- L'intercepteur HTTP attend un refresh token deja en cours avant d'envoyer de nouvelles requetes authentifiees.
- En cas de `401`, l'intercepteur tente un rafraichissement de token puis rejoue la requete avec le nouveau token.
- Les requetes qui utilisent le refresh cookie sont envoyees avec `withCredentials`.
- Les tokens locaux sont supprimes lors de la deconnexion.
- Les caches locaux de parametres, brouillons et emails sont separes par utilisateur et par compte actif.
- Les rendus HTML d'emails sont isoles dans un Shadow DOM pour eviter que le CSS des emails ne casse l'interface principale.

## Notifications De Securite

- Une notification email peut etre envoyee lors d'une connexion depuis une combinaison appareil/IP jamais vue auparavant.
- La detection de nouvel appareil utilise une signature normalisee du User-Agent et un prefixe IP grossier.
- L'envoi de cette notification ne bloque jamais la connexion si l'envoi email echoue.
