# E2E — tests d'attaque

Ces tests attaquent la **pile réelle**, celle qui tourne en production, depuis
la position d'un client qui contrôle entièrement son navigateur : cookies,
en-têtes, requêtes HTTP brutes.

| Composant | Ce qui tourne |
|---|---|
| MongoDB | `mongodb-memory-server` (vrai `mongod` 7.0, en mémoire) |
| Backend | `node backend/dist/main.js` — le build de production |
| Frontend | `next start` ×2 : une instance en HTTP, une avec `AUTH_URL` en HTTPS |
| Google | remplacé par des cookies de session fabriqués avec la version d'Auth.js du frontend : Google n'intervient qu'à la connexion, pas dans ce qui est attaqué |

## Lancer

```bash
cd backend  && npm ci && npm run build
cd frontend && npm ci && npm run build
cd e2e      && npm ci && npm test        # ~1 min, télécharge mongod au premier lancement
```

## Ce qui est vérifié

- **Backend** : aucune route (hors sondes) sans jeton ; refus des jetons forgés
  (autre secret, `alg: none`, HS512, expiré, durée excessive, autre audience,
  émetteur inconnu, contenu modifié après signature) ; le secret du MCP
  n'ouvre que le compte du MCP.
- **Frontend** : aucune page sans session valide (cookie absent, altéré d'un
  caractère, chiffré par un autre secret, inventé, compte hors liste
  blanche) ; isolation des données entre Alice et Bob.
- **Server Actions** appelées en HTTP brut, avec des identifiants extraits du
  JavaScript public (comme le ferait un attaquant) : Bob ne peut ni retirer le
  mot-clé, ni le favori, ni la station d'Alice, même en ajoutant un argument
  `userId` ; un anonyme ne peut rien appeler ; un autre site ne peut pas en
  déclencher avec le cookie d'Alice (CSRF).
- **Transport** : pas de redirection ouverte après connexion ; avec `AUTH_URL`
  en HTTPS, cookies `Secure`/`HttpOnly` à préfixe `__Host-`/`__Secure-`, et
  cookie de session sans préfixe ignoré.
- **Fuites** : aucun secret dans les pages, la session exposée ou le
  JavaScript envoyé au navigateur.
- **Quotas** : refus au-delà de `MAX_KEYWORDS_PER_USER` et
  `MAX_TRACKED_URLS_PER_USER` (favoris compris), sans rien écrire, et message
  rendu à l'utilisateur.

## Règles d'écriture

- **Juger sur l'état de la base**, pas seulement sur un code HTTP : une
  attaque « refusée » qui aurait quand même écrit est un échec.
- **Chaque refus a son témoin positif** : la même requête, légitime, doit
  réussir. Sans lui, un test d'interdiction passerait aussi sur une requête
  mal formée (mauvais identifiant d'action, mauvaise page…).
- La suite a été validée par **mutation** : désactiver la restriction du MCP
  à son compte, ou la revérification de la liste blanche à chaque requête,
  fait échouer les tests correspondants.
