#!/usr/bin/env bash
# Installation / mise à jour de price-tracker sur un cluster Kubernetes.
#
# Conçu pour être relancé sans friction :
#   - les réponses sont mémorisées dans k8s/install.conf (non commité) et
#     proposées par défaut aux relances ;
#   - aucun fichier suivi par git n'est modifié : le script génère un overlay
#     dans k8s/overlays/local/ (non commité) puis l'applique ;
#   - secrets.env et le pull secret existants sont conservés par défaut.
#
# Usage :
#   ./install.sh                installation ou mise à jour interactive
#   ./install.sh -y             redéploie sans question avec les réponses sauvées
#   ./install.sh -y --restart   idem + rollout restart (tire les nouvelles images)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$SCRIPT_DIR/base"
OVERLAY_DIR="$SCRIPT_DIR/overlays/local"
CONF_FILE="$SCRIPT_DIR/install.conf"
SECRETS_FILE="$BASE_DIR/secrets.env"
NAMESPACE="price-tracker"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!!\033[0m %s\n' "$1"; }
err()  { printf '\033[31mERREUR:\033[0m %s\n' "$1" >&2; }

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
}

ASSUME_YES=false
DO_RESTART=false
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=true ;;
    --restart) DO_RESTART=true ;;
    -h|--help) usage; exit 0 ;;
    *) err "Option inconnue : $arg"; usage; exit 1 ;;
  esac
done

ask() {
  # ask <var> <prompt> [default] — valeur requise ; le défaut vient de
  # install.conf aux relances. En mode -y, le défaut est pris sans question.
  local __var="$1" __prompt="$2" __default="${3:-}" __reply
  if [[ "$ASSUME_YES" == "true" ]]; then
    if [[ -n "$__default" ]]; then
      printf -v "$__var" '%s' "$__default"
      return
    fi
    err "Mode -y : aucune valeur mémorisée pour « $__prompt ». Relance sans -y."
    exit 1
  fi
  if [[ -n "$__default" ]]; then
    read -r -p "$__prompt [$__default]: " __reply
    __reply="${__reply:-$__default}"
  else
    while true; do
      read -r -p "$__prompt: " __reply
      [[ -n "$__reply" ]] && break
      warn "Valeur requise."
    done
  fi
  printf -v "$__var" '%s' "$__reply"
}

ask_secret() {
  # ask_secret <var> <prompt> [generated_default]
  local __var="$1" __prompt="$2" __default="${3:-}" __reply
  if [[ "$ASSUME_YES" == "true" ]]; then
    err "Mode -y : « $__prompt » doit être saisi. Relance sans -y."
    exit 1
  fi
  if [[ -n "$__default" ]]; then
    read -r -s -p "$__prompt [Entrée = valeur générée automatiquement]: " __reply
    echo
    __reply="${__reply:-$__default}"
  else
    while true; do
      read -r -s -p "$__prompt: " __reply
      echo
      [[ -n "$__reply" ]] && break
      warn "Valeur requise."
    done
  fi
  printf -v "$__var" '%s' "$__reply"
}

confirm() {
  # confirm <prompt> [réponse en mode -y : y|n (défaut n)]
  local __prompt="$1" __yes_default="${2:-n}" __reply
  if [[ "$ASSUME_YES" == "true" ]]; then
    [[ "$__yes_default" == "y" ]]
    return
  fi
  read -r -p "$__prompt [o/N]: " __reply
  [[ "$__reply" =~ ^[oOyY]$ ]]
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "'$1' est requis mais introuvable dans le PATH."; exit 1; }
}

gen_fernet_key() {
  # 32 octets aléatoires, base64 urlsafe — même format que Fernet.generate_key()
  openssl rand -base64 32 | tr '+/' '-_'
}

gen_hex_key() {
  openssl rand -hex 32
}

echo
bold "=== Installation / mise à jour de price-tracker (Kubernetes) ==="
echo

require_cmd kubectl
require_cmd openssl

# Réponses de la dernière exécution (défauts des prompts ci-dessous).
GITHUB_OWNER=""
IMAGE_TAG="main"
AIRFLOW_DOMAIN=""
GHCR_PRIVATE=""
GHCR_USERNAME=""
if [[ -f "$CONF_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONF_FILE"
  info "Réponses précédentes chargées depuis $CONF_FILE"
fi

# ---------------------------------------------------------------------------
info "Étape 0 — Contexte kubectl"
CURRENT_CTX="$(kubectl config current-context 2>/dev/null || echo '<aucun>')"
echo "Contexte kubectl actif : $CURRENT_CTX"
if ! confirm "Continuer l'installation sur ce contexte ?" y; then
  err "Installation annulée. Change de contexte avec 'kubectl config use-context <ctx>' puis relance le script."
  exit 1
fi

# ---------------------------------------------------------------------------
info "Étape 1 — Images GHCR et domaine Airflow"
ask GITHUB_OWNER "Owner GitHub des images (ghcr.io/<owner>/item_scrapper-*)" "$GITHUB_OWNER"
ask IMAGE_TAG "Tag des images à déployer" "$IMAGE_TAG"

# Le frontend est servi en catch-all (tous les hostnames) : pas de domaine.
# Le domaine ne sert qu'à l'ingress Airflow (airflow.<domaine>) ; sans lui,
# l'ingress Airflow est supprimé et le webserver reste joignable en NodePort.
if [[ "$ASSUME_YES" != "true" ]]; then
  read -r -p "Domaine Airflow (Entrée = ${AIRFLOW_DOMAIN:-aucun, NodePort 30808 seulement} ; '-' = retirer): " __reply
  if [[ "$__reply" == "-" ]]; then
    AIRFLOW_DOMAIN=""
  else
    AIRFLOW_DOMAIN="${__reply:-$AIRFLOW_DOMAIN}"
  fi
fi

# ---------------------------------------------------------------------------
info "Étape 2 — Packages GHCR privés ?"
if [[ -z "$GHCR_PRIVATE" ]]; then
  if confirm "Les packages ghcr.io/${GITHUB_OWNER}/item_scrapper-* sont-ils privés ?"; then
    GHCR_PRIVATE=true
  else
    GHCR_PRIVATE=false
  fi
else
  info "Packages privés : $GHCR_PRIVATE (mémorisé — édite $CONF_FILE pour changer)"
fi

# Réponses non secrètes mémorisées pour les prochaines exécutions.
cat > "$CONF_FILE" <<EOF
# Généré par k8s/install.sh — non commité, éditable à la main.
GITHUB_OWNER=${GITHUB_OWNER}
IMAGE_TAG=${IMAGE_TAG}
AIRFLOW_DOMAIN=${AIRFLOW_DOMAIN}
GHCR_PRIVATE=${GHCR_PRIVATE}
GHCR_USERNAME=${GHCR_USERNAME}
EOF

# ---------------------------------------------------------------------------
info "Étape 3 — Namespace et pull secret GHCR"
if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  kubectl create namespace "$NAMESPACE"
  info "Namespace '$NAMESPACE' créé."
fi

if [[ "$GHCR_PRIVATE" == "true" ]]; then
  RECREATE_PULL_SECRET=true
  if kubectl -n "$NAMESPACE" get secret ghcr-pull-secret >/dev/null 2>&1; then
    RECREATE_PULL_SECRET=false
    if confirm "Le secret 'ghcr-pull-secret' existe déjà — le recréer (nouveau token) ?"; then
      RECREATE_PULL_SECRET=true
      kubectl -n "$NAMESPACE" delete secret ghcr-pull-secret
    fi
  fi
  if [[ "$RECREATE_PULL_SECRET" == "true" ]]; then
    ask GHCR_USERNAME "Username GitHub" "$GHCR_USERNAME"
    ask_secret GHCR_TOKEN "Personal Access Token GitHub (scope read:packages)"
    kubectl create secret docker-registry ghcr-pull-secret \
      --namespace "$NAMESPACE" \
      --docker-server=ghcr.io \
      --docker-username="$GHCR_USERNAME" \
      --docker-password="$GHCR_TOKEN"
    sed -i "s/^GHCR_USERNAME=.*/GHCR_USERNAME=${GHCR_USERNAME}/" "$CONF_FILE"
  fi
  info "Pull secret 'ghcr-pull-secret' prêt."
fi

# ---------------------------------------------------------------------------
info "Étape 4 — Secrets applicatifs (k8s/base/secrets.env)"
GENERATE_SECRETS=true
if [[ -f "$SECRETS_FILE" ]]; then
  GENERATE_SECRETS=false
  if confirm "$SECRETS_FILE existe — l'écraser avec de nouvelles valeurs ?"; then
    GENERATE_SECRETS=true
  else
    info "Conservation du secrets.env existant."
  fi
elif [[ "$ASSUME_YES" == "true" ]]; then
  err "Mode -y : $SECRETS_FILE est absent. Relance sans -y pour le générer."
  exit 1
fi

if [[ "$GENERATE_SECRETS" == "true" ]]; then
  ask MONGO_ROOT_USERNAME "MONGO_ROOT_USERNAME (MongoDB interne, déployé par k8s/base/mongodb.yaml)" "admin"
  ask_secret MONGO_ROOT_PASSWORD "MONGO_ROOT_PASSWORD"
  MONGODB_URI="mongodb://${MONGO_ROOT_USERNAME}:${MONGO_ROOT_PASSWORD}@mongodb:27017/scrapper?authSource=admin"

  ask AIRFLOW_DB_USER "AIRFLOW_DB_USER (Postgres interne Airflow)" "airflow"
  ask_secret AIRFLOW_DB_PASSWORD "AIRFLOW_DB_PASSWORD"
  ask AIRFLOW_ADMIN_USERNAME "AIRFLOW_ADMIN_USERNAME (compte admin webui Airflow)" "admin"
  ask_secret AIRFLOW_ADMIN_PASSWORD "AIRFLOW_ADMIN_PASSWORD"

  ask_secret AIRFLOW_FERNET_KEY "AIRFLOW_FERNET_KEY" "$(gen_fernet_key)"
  ask_secret AIRFLOW_SECRET_KEY "AIRFLOW_SECRET_KEY" "$(gen_hex_key)"

  # Seule protection de l'Ingress /mcp, qui porte des outils d'écriture : le
  # Deployment MCP le lit en secretKeyRef non optionnel, sans lui le pod ne
  # démarre pas. À recopier ensuite dans la configuration de l'agent.
  ask_secret MCP_AUTH_TOKEN "MCP_AUTH_TOKEN (jeton porteur du serveur MCP)" "$(gen_hex_key)"

  AIRFLOW_SQL_ALCHEMY_CONN="postgresql+psycopg2://${AIRFLOW_DB_USER}:${AIRFLOW_DB_PASSWORD}@airflow-postgres/airflow"

  umask 077
  cat > "$SECRETS_FILE" <<EOF
MONGO_ROOT_USERNAME=${MONGO_ROOT_USERNAME}
MONGO_ROOT_PASSWORD=${MONGO_ROOT_PASSWORD}
MONGODB_URI=${MONGODB_URI}

AIRFLOW_DB_USER=${AIRFLOW_DB_USER}
AIRFLOW_DB_PASSWORD=${AIRFLOW_DB_PASSWORD}
AIRFLOW_SQL_ALCHEMY_CONN=${AIRFLOW_SQL_ALCHEMY_CONN}

AIRFLOW_ADMIN_USERNAME=${AIRFLOW_ADMIN_USERNAME}
AIRFLOW_ADMIN_PASSWORD=${AIRFLOW_ADMIN_PASSWORD}

AIRFLOW_FERNET_KEY=${AIRFLOW_FERNET_KEY}
AIRFLOW_SECRET_KEY=${AIRFLOW_SECRET_KEY}

MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
EOF
  chmod 600 "$SECRETS_FILE"
  info "$SECRETS_FILE écrit (permissions 600, non commité)."
fi

# Une installation antérieure au serveur MCP a un secrets.env sans
# MCP_AUTH_TOKEN, et le conserver est le choix par défaut : sans ce rattrapage
# le pod MCP resterait en CreateContainerConfigError après la mise à jour.
# Un jeton déjà présent n'est jamais régénéré — il est connu de l'agent.
if ! grep -q '^MCP_AUTH_TOKEN=' "$SECRETS_FILE"; then
  printf '\nMCP_AUTH_TOKEN=%s\n' "$(gen_hex_key)" >> "$SECRETS_FILE"
  warn "MCP_AUTH_TOKEN était absent de $SECRETS_FILE : un jeton a été généré."
  warn "Récupère-le pour la configuration de l'agent :"
  echo "    grep MCP_AUTH_TOKEN $SECRETS_FILE"
fi

# ---------------------------------------------------------------------------
info "Étape 5 — Génération de l'overlay k8s/overlays/local/"
mkdir -p "$OVERLAY_DIR"
{
  cat <<EOF
# Généré par k8s/install.sh — non commité, régénéré à chaque exécution.
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

images:
  - name: ghcr.io/REPLACE_GITHUB_OWNER/item_scrapper-backend
    newName: ghcr.io/${GITHUB_OWNER}/item_scrapper-backend
    newTag: "${IMAGE_TAG}"
  - name: ghcr.io/REPLACE_GITHUB_OWNER/item_scrapper-mcp
    newName: ghcr.io/${GITHUB_OWNER}/item_scrapper-mcp
    newTag: "${IMAGE_TAG}"
  - name: ghcr.io/REPLACE_GITHUB_OWNER/item_scrapper-frontend
    newName: ghcr.io/${GITHUB_OWNER}/item_scrapper-frontend
    newTag: "${IMAGE_TAG}"
  - name: ghcr.io/REPLACE_GITHUB_OWNER/item_scrapper-airflow
    newName: ghcr.io/${GITHUB_OWNER}/item_scrapper-airflow
    newTag: "${IMAGE_TAG}"

configMapGenerator:
  - name: price-tracker-config
    behavior: merge
    literals:
      - IMAGE_REGISTRY=ghcr.io/${GITHUB_OWNER}/item_scrapper

generatorOptions:
  disableNameSuffixHash: true
EOF
  if [[ -n "$AIRFLOW_DOMAIN" ]]; then
    cat <<EOF

# L'ingress frontend est catch-all (sans host) — seul Airflow a un host.
patches:
  - target:
      kind: Ingress
      name: airflow-webserver
    patch: |-
      - op: replace
        path: /spec/rules/0/host
        value: airflow.${AIRFLOW_DOMAIN}
EOF
  else
    cat <<EOF

# Pas de domaine Airflow : on supprime son ingress (accès via NodePort 30808).
patches:
  - target:
      kind: Ingress
      name: airflow-webserver
    patch: |-
      apiVersion: networking.k8s.io/v1
      kind: Ingress
      metadata:
        name: airflow-webserver
        namespace: price-tracker
      \$patch: delete
EOF
  fi
} > "$OVERLAY_DIR/kustomization.yaml"
info "Overlay écrit dans $OVERLAY_DIR/kustomization.yaml"

# ---------------------------------------------------------------------------
info "Étape 6 — Application des manifests"
bold "Récapitulatif avant apply :"
echo "  Contexte kubectl  : $CURRENT_CTX"
echo "  Namespace         : $NAMESPACE"
echo "  Images            : ghcr.io/${GITHUB_OWNER}/item_scrapper-* : ${IMAGE_TAG}"
echo "  Frontend          : catch-all (tous les hostnames)"
echo "  Backend           : interne au cluster (ClusterIP, aucun ingress)"
echo "  MCP               : exposé sur <n'importe quel hostname>/mcp, jeton requis"
echo "  Airflow           : ${AIRFLOW_DOMAIN:+ingress airflow.$AIRFLOW_DOMAIN + }NodePort 30808"
echo "  secrets.env       : $([[ "$GENERATE_SECRETS" == "true" ]] && echo "régénéré" || echo "conservé")"
if ! confirm "Lancer 'kubectl apply -k k8s/overlays/local' maintenant ?" y; then
  warn "Apply non lancé. Tu peux le faire manuellement plus tard avec :"
  echo "    kubectl apply -k $OVERLAY_DIR"
  exit 0
fi

# Le template d'un Job est immuable : on supprime airflow-init avant l'apply
# pour qu'un changement de tag d'image ne fasse pas échouer l'apply. Le Job
# est idempotent (db migrate + création du compte admin si absent).
kubectl -n "$NAMESPACE" delete job airflow-init --ignore-not-found >/dev/null

kubectl apply -k "$OVERLAY_DIR"

# ---------------------------------------------------------------------------
info "Étape 7 — Vérification du Job airflow-init"
echo "Attente de la complétion du Job (jusqu'à 2 minutes)..."
if kubectl -n "$NAMESPACE" wait --for=condition=complete job/airflow-init --timeout=120s 2>/dev/null; then
  info "airflow-init terminé avec succès."
else
  warn "airflow-init n'a pas atteint l'état 'complete' dans le délai. Logs :"
  kubectl -n "$NAMESPACE" logs job/airflow-init --tail=50 || true
fi

# ---------------------------------------------------------------------------
if [[ "$DO_RESTART" == "true" ]] || confirm "Rollout restart des deployments (tirer les images '${IMAGE_TAG}' fraîchement buildées) ?"; then
  kubectl -n "$NAMESPACE" rollout restart deployment \
    price-tracker-backend price-tracker-mcp price-tracker-frontend \
    airflow-webserver airflow-scheduler
  info "Rollout restart lancé."
fi

echo
bold "=== Terminé ==="
echo "Vérifie l'état du cluster avec :"
echo "    kubectl -n $NAMESPACE get pods"
echo "    kubectl -n $NAMESPACE get ingress"
echo
echo "Prochaines mises à jour (après un build CI) :"
echo "    ./k8s/install.sh -y --restart"
