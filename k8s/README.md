# k8s

Manifests Kustomize. `base/` est générique (placeholders), `overlays/prod/`
fixe le owner GitHub réel et le domaine.

## Vue d'ensemble : CI vs CD

Il y a deux étapes bien séparées, **aucune des deux entièrement automatisée
de bout en bout aujourd'hui** :

1. **CI (automatisée)** — 6 workflows GitHub Actions, un par image,
   déclenchés sur push `main` (ou tag `v*.*.*`) quand leur dossier change :
   - `.github/workflows/backend.yml` → `ghcr.io/<owner>/item_scrapper-backend`
     (typecheck + tests avant de publier)
   - `.github/workflows/mcp.yml` → `ghcr.io/<owner>/item_scrapper-mcp`
     (typecheck + tests avant de publier)
   - `.github/workflows/frontend.yml` → `ghcr.io/<owner>/item_scrapper-frontend`
   - `.github/workflows/airflow.yml` → `ghcr.io/<owner>/item_scrapper-airflow`
   - `.github/workflows/scrapper.yml` → `ghcr.io/<owner>/item_scrapper-scrapper`
   - `.github/workflows/pipeline.yml` → `ghcr.io/<owner>/item_scrapper-pipeline`

   Chacun build + push l'image sur GHCR et s'arrête là. **Il n'y a pas de
   step de déploiement dans ces workflows.**

2. **CD (manuelle)** — appliquer les manifests sur le cluster avec
   `kubectl apply -k`. C'est l'objet de ce document. `price-tracker-frontend`
   et `price-tracker-airflow` (webserver/scheduler) tournent en Deployment et
   pointent sur le tag `main` avec `imagePullPolicy: Always` : un nouveau push
   sur `main` republie l'image, mais **le cluster ne la retire pas tout seul**
   — il faut soit attendre le prochain redémarrage naturel du Pod, soit forcer
   un rollout (voir "Mettre à jour après un nouveau build" plus bas).

   Les images `scrapper` et `pipeline` ne sont pas déployées en permanence :
   elles sont lancées à la demande comme Pods éphémères par le DAG Airflow
   via `KubernetesPodOperator`. Même tag `main`, mais pas la même remarque :
   ces Pods naissent à chaque exécution avec `image_pull_policy="Always"`
   (réglé dans le DAG, cf. `_build_k8s_task`), donc ils prennent la dernière
   image publiée sans rollout à forcer. Sans ce réglage explicite, Kubernetes
   retomberait sur `IfNotPresent` et rejouerait indéfiniment l'image en cache
   sur le nœud.

## Architecture déployée

- `price-tracker-backend` (Deployment + Service **ClusterIP, sans Ingress**) — API
  NestJS, seul composant applicatif qui lit Mongo pour l'affichage. Joignable
  uniquement depuis l'intérieur du cluster, à `http://price-tracker-backend`.
- `price-tracker-mcp` (Deployment + Service + Ingress sur `/mcp`) — serveur MCP
  pour l'agent externe. **Seul composant applicatif volontairement exposé hors
  du cluster**, parce que l'agent n'y tourne pas. Il n'ouvre pas de connexion
  Mongo : il appelle le backend comme le frontend. Sa seule protection est le
  jeton `MCP_AUTH_TOKEN` du Secret — ne pas l'appliquer sans l'avoir renseigné.
- `price-tracker-frontend` (Deployment + Service + Ingress) — Next.js ; appelle
  le backend côté serveur
- `mongodb` (StatefulSet) — DB applicative (`scrapper.items_raw`), volume persistant 5Gi
- `airflow-postgres` (StatefulSet) — metadata DB d'Airflow, volume persistant 2Gi
- `airflow-webserver` / `airflow-scheduler` (Deployments) — orchestrent le pipeline
- `airflow-init` (Job, à lancer une fois) — `airflow db migrate` + création du compte admin
- `airflow-rbac.yaml` — ServiceAccount `airflow-scheduler` + Role/RoleBinding
  permettant au scheduler de créer/lister/logger des Pods dans le namespace
  (nécessaire pour que `KubernetesPodOperator` fonctionne)

Le scraping n'a pas de CronJob k8s dédié : c'est le DAG Airflow
(`price_pipeline_dag`, schedule `0 6 * * *`, défini dans
`airflow/dags/price_pipeline_dag.py`) qui lance scrape → refine → train →
score, chaque étape comme un Pod éphémère via `KubernetesPodOperator`.

MongoDB est déployé en cluster (`k8s/base/mongodb.yaml`, StatefulSet +
PVC 5Gi) ; `MONGODB_URI` (construite à partir de `MONGO_ROOT_USERNAME` /
`MONGO_ROOT_PASSWORD`, voir `secrets.env.example`) pointe sur le Service
interne `mongodb:27017`.

Un second Service `mongodb-external` (NodePort `30017`) expose Mongo sur le
LAN pour un accès direct (ex. MongoDB Compass) via `<IP-du-nœud>:30017`,
avec les identifiants `MONGO_ROOT_USERNAME`/`MONGO_ROOT_PASSWORD`. Pas de
TLS sur cette connexion — à ne jamais exposer au-delà du réseau local.

## Pré-requis

- Un cluster Kubernetes accessible (`kubectl` configuré avec le bon contexte)
- Un Ingress Controller installé — `ingress.yaml` cible `ingressClassName: traefik`
  (embarqué par défaut avec k3s) ; si ton cluster n'a pas Traefik, adapte ce
  champ à ton Ingress Controller (ex. `nginx`), sinon `ingress.yaml` n'aura
  aucun effet
- `kustomize` (intégré à `kubectl` depuis la 1.14, `kubectl apply -k` suffit)
- Les images GHCR poussées au moins une fois par les 4 workflows CI ci-dessus

## Première installation

Le plus simple est le script interactif `k8s/install.sh`, qui déroule toutes
les étapes ci-dessous (overlay, secrets, pull secret GHCR, apply, vérification
du Job `airflow-init`) en demandant chaque valeur en saisie :

```bash
./k8s/install.sh
```

Détail manuel équivalent, si tu préfères ne pas utiliser le script :

```bash
# 1. Secrets — jamais commités, à remplir à la main
cp k8s/base/secrets.env.example k8s/base/secrets.env
# éditer k8s/base/secrets.env :
#   - MONGO_ROOT_USERNAME / MONGO_ROOT_PASSWORD (Mongo interne, déployé par mongodb.yaml)
#     puis MONGODB_URI doit reprendre les mêmes valeurs :
#     mongodb://<MONGO_ROOT_USERNAME>:<MONGO_ROOT_PASSWORD>@mongodb:27017/scrapper?authSource=admin
#   - AIRFLOW_DB_USER / AIRFLOW_DB_PASSWORD (Postgres interne, déployé par postgres.yaml)
#   - AIRFLOW_SQL_ALCHEMY_CONN (doit réutiliser les mêmes user/password que ci-dessus)
#   - AIRFLOW_ADMIN_USERNAME / AIRFLOW_ADMIN_PASSWORD (compte créé par le Job airflow-init)
#   - AIRFLOW_FERNET_KEY  → python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
#   - AIRFLOW_SECRET_KEY  → python -c "import secrets; print(secrets.token_hex(32))"
#   - Connexion Google (cf. « Connexion Google » ci-dessous) :
#     BACKEND_AUTH_SECRET, MCP_BACKEND_AUTH_SECRET (différent), AUTH_SECRET
#       → openssl rand -hex 32 chacun
#     AUTH_URL = URL publique HTTPS (obligatoire)
#     AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (client OAuth), AUTH_ALLOWED_EMAILS,
#     AUTH_LEGACY_OWNER_EMAIL (reçoit les données existantes), MCP_USER_EMAIL

# 2. Owner GHCR + domaine — édités à la main dans l'overlay
#    k8s/overlays/prod/kustomization.yaml :
#      - remplacer YOUR_GITHUB_USERNAME (3 occurrences) par le vrai owner GitHub
#        des images (ghcr.io/<owner>/item_scrapper-*)
#      - remplacer prices.example.com par le vrai domaine (utilisé uniquement
#        pour l'ingress Airflow : airflow.<domaine>). L'ingress frontend est
#        catch-all : il répond sur tous les hostnames (miniserver01.home,
#        miniserver01.local, IP, ...), aucun domaine à configurer.

# 3. Si les packages GHCR sont privés : namespace + pull secret
kubectl create namespace price-tracker
kubectl create secret docker-registry ghcr-pull-secret \
  --namespace price-tracker \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-PAT-avec-scope-read:packages>

# 4. Appliquer tous les manifests
kubectl apply -k k8s/overlays/prod

# 5. Initialiser Airflow (une seule fois ; le Job tourne automatiquement
#    via l'apply ci-dessus, mais vérifier qu'il a réussi) :
kubectl -n price-tracker get jobs airflow-init
kubectl -n price-tracker logs job/airflow-init
```

Vérifications après install :

```bash
kubectl -n price-tracker get pods
kubectl -n price-tracker get ingress
```

## Connexion Google

L'application exige une connexion Google. À faire une fois :

1. **Un domaine public en HTTPS.** Google n'accepte comme URL de redirection
   OAuth que `http://localhost` ou une URL `https://` sur un domaine public —
   ni IP, ni `.home` / `.local`. Il faut donc un nom (DNS dynamique, domaine
   personnel, Tailscale Funnel…) et un certificat : décommenter la section `tls`
   de `base/ingress.yaml` (cert-manager) avec ce nom. Les autres noms
   continuent de servir les pages, mais la connexion n'aboutit que via celui-ci.
2. **Un client OAuth** dans la Google Cloud Console : *API et services →
   Identifiants → Créer → ID client OAuth → Application Web*, avec pour URI de
   redirection autorisée `https://<domaine>/api/auth/callback/google`. L'écran
   de consentement peut rester en mode « Test » en y ajoutant les adresses
   autorisées comme utilisateurs de test.
3. **`secrets.env`** : `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, la liste blanche
   `AUTH_ALLOWED_EMAILS` (fortement conseillée : chaque mot-clé coûte du budget
   de crawl), ton adresse dans `AUTH_LEGACY_OWNER_EMAIL` (les mots-clés,
   favoris et stations existants te sont rattachés au démarrage du backend) et
   `MCP_USER_EMAIL` (compte au nom duquel agit l'agent), et **`AUTH_URL=https://<domaine>`**
   (obligatoire : sans elle le Pod frontend ne démarre pas). C'est elle qui
   fait poser des cookies `Secure` (`__Secure-` / `__Host-`), que le navigateur
   n'envoie jamais en HTTP clair : une session volée sur le réseau local est
   impossible à rejouer en HTTP.
4. **Secrets internes** : `BACKEND_AUTH_SECRET` (frontend → backend) et
   `MCP_BACKEND_AUTH_SECRET` (MCP → backend, accepté uniquement pour
   `MCP_USER_EMAIL`) doivent être **différents** — le backend refuse de démarrer
   sinon. Quotas par utilisateur : `MAX_KEYWORDS_PER_USER` /
   `MAX_TRACKED_URLS_PER_USER` dans `base/backend-deployment.yaml`.

`install.sh` demande ces valeurs, y compris sur un `secrets.env` existant
(mise à jour d'une installation antérieure à la connexion Google).

## Mettre à jour après un nouveau build

`kubectl apply -k` ne change rien si seuls les manifests sont identiques et
que le tag d'image (`main`) n'a pas changé au niveau du digest connu par
Kubernetes — il faut forcer un rollout pour récupérer la dernière image
poussée par la CI :

```bash
kubectl -n price-tracker rollout restart deployment price-tracker-backend
kubectl -n price-tracker rollout restart deployment price-tracker-mcp
kubectl -n price-tracker rollout restart deployment price-tracker-frontend
kubectl -n price-tracker rollout restart deployment airflow-webserver
kubectl -n price-tracker rollout restart deployment airflow-scheduler
```

Les Pods éphémères `scrape`/`purge`/`refine`/`score` (lancés par Airflow)
récupèrent toujours la dernière image `main` au moment de leur création, sans
action manuelle nécessaire : c'est `image_pull_policy="Always"` dans
`airflow/dags/price_pipeline_dag.py` qui l'assure. Un DAG qui gagne une étape
échouerait sinon sur une image trop vieille pour la connaître.

Si des manifests YAML ont changé (nouvelle env var, ressources, etc.),
relancer simplement :

```bash
kubectl apply -k k8s/overlays/prod
```

## Variabiliser pour un autre environnement

Dupliquer `k8s/overlays/prod` (ex. `overlays/staging`) avec un autre owner
d'image, domaine, ou `secrets.env`.

## Automatiser le déploiement (pas encore fait)

Aujourd'hui rien n'appelle `kubectl apply -k` automatiquement après un build
CI. Pour fermer la boucle CI → CD, il faudrait un 5e workflow GitHub Actions
(ex. `deploy.yml`), déclenché après succès des 4 builds sur `main`, qui :

1. Récupère un kubeconfig (secret GitHub Actions, ou OIDC vers le cloud provider)
2. Lance `kubectl apply -k k8s/overlays/prod`
3. Force le `rollout restart` des Deployments concernés

Pré-requis pour que ça vaille le coup : que `secrets.env` et les
remplacements d'overlay (owner GHCR, domaine) soient déjà figés dans des
secrets GitHub plutôt que édités à la main à chaque install, et que le
runner GitHub ait un accès réseau vers l'API server du cluster.
