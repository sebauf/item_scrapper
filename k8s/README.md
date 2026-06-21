# k8s

Manifests Kustomize. `base/` est générique (placeholders), `overlays/prod/`
fixe le owner GitHub réel et le domaine.

## Architecture déployée

- `price-tracker-frontend` (Deployment + Service + Ingress) — lit Mongo directement
- `airflow-postgres` (StatefulSet) — metadata DB d'Airflow
- `airflow-webserver` / `airflow-scheduler` (Deployments) — orchestrent le pipeline
- `airflow-init` (Job) — `airflow db migrate` + création du compte admin
- `airflow-rbac.yaml` — ServiceAccount + Role/RoleBinding permettant au scheduler
  de créer des Pods (KubernetesPodOperator) pour les tâches `scrape` / `refine` /
  `train` / `score`, définies dans `airflow/dags/price_pipeline_dag.py`
- `pipeline-models` (PVC) — partagé entre `train` et `score`

Le scraping n'a plus de CronJob k8s dédié : c'est le DAG Airflow
(`price_pipeline_dag`, schedule `0 6 * * *`) qui lance scrape → refine → train
→ score, chaque étape comme un Pod éphémère.

MongoDB n'est pas déployé ici (managé en externe — Atlas, etc.) ; seule
`MONGODB_URI` est attendue via secret.

## Première installation

```bash
cp k8s/base/secrets.env.example k8s/base/secrets.env
# éditer k8s/base/secrets.env avec les vraies valeurs (jamais commité)

# si les packages GHCR sont privés :
kubectl create namespace price-tracker
kubectl create secret docker-registry ghcr-pull-secret \
  --namespace price-tracker \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-PAT-avec-scope-read:packages>
```

Éditer `k8s/overlays/prod/kustomization.yaml` : remplacer
`YOUR_GITHUB_USERNAME` par le owner GitHub réel des images (`ghcr.io/<owner>/item_scrapper-*`,
poussées par `.github/workflows/{scrapper,pipeline,frontend,airflow}.yml`), et
le host de l'Ingress par le vrai domaine.

```bash
kubectl apply -k k8s/overlays/prod
```

## Variabiliser pour un autre environnement

Dupliquer `k8s/overlays/prod` (ex. `overlays/staging`) avec un autre owner
d'image, domaine, ou `secrets.env`.
