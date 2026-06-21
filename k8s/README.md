# k8s

Manifests Kustomize. `base/` est générique (placeholders), `overlays/prod/`
fixe le owner GitHub réel et le domaine.

## Vue d'ensemble : CI vs CD

Il y a deux étapes bien séparées, **aucune des deux entièrement automatisée
de bout en bout aujourd'hui** :

1. **CI (automatisée)** — 4 workflows GitHub Actions, un par image,
   déclenchés sur push `main` (ou tag `v*.*.*`) quand leur dossier change :
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
   via `KubernetesPodOperator` (tag `main` également, donc même remarque).

## Architecture déployée

- `price-tracker-frontend` (Deployment + Service + Ingress) — lit Mongo directement
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

MongoDB n'est pas déployé ici (managé en externe — Atlas, etc.) ; seule
`MONGODB_URI` est attendue via secret.

## Pré-requis

- Un cluster Kubernetes accessible (`kubectl` configuré avec le bon contexte)
- Un Ingress Controller installé (ex. `ingress-nginx`) — sinon `ingress.yaml`
  n'aura aucun effet
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
#   - MONGODB_URI (Mongo externe)
#   - AIRFLOW_DB_USER / AIRFLOW_DB_PASSWORD (Postgres interne, déployé par postgres.yaml)
#   - AIRFLOW_SQL_ALCHEMY_CONN (doit réutiliser les mêmes user/password que ci-dessus)
#   - AIRFLOW_ADMIN_USERNAME / AIRFLOW_ADMIN_PASSWORD (compte créé par le Job airflow-init)
#   - AIRFLOW_FERNET_KEY  → python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
#   - AIRFLOW_SECRET_KEY  → python -c "import secrets; print(secrets.token_hex(32))"

# 2. Owner GHCR + domaine — édités à la main dans l'overlay
#    k8s/overlays/prod/kustomization.yaml :
#      - remplacer YOUR_GITHUB_USERNAME (3 occurrences) par le vrai owner GitHub
#        des images (ghcr.io/<owner>/item_scrapper-*)
#      - remplacer prices.example.com par le vrai domaine

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

## Mettre à jour après un nouveau build

`kubectl apply -k` ne change rien si seuls les manifests sont identiques et
que le tag d'image (`main`) n'a pas changé au niveau du digest connu par
Kubernetes — il faut forcer un rollout pour récupérer la dernière image
poussée par la CI :

```bash
kubectl -n price-tracker rollout restart deployment price-tracker-frontend
kubectl -n price-tracker rollout restart deployment airflow-webserver
kubectl -n price-tracker rollout restart deployment airflow-scheduler
```

Les Pods éphémères `scrape`/`refine`/`train`/`score` (lancés par Airflow)
récupèrent toujours la dernière image `main` au moment de leur création
(`imagePullPolicy: Always`), sans action manuelle nécessaire.

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
