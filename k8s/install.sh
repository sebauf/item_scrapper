#!/usr/bin/env bash
# Installation interactive de price-tracker sur un cluster Kubernetes.
# Déroule la procédure décrite dans k8s/README.md : édition de l'overlay,
# génération de secrets.env, pull secret GHCR optionnel, apply, vérification
# du Job airflow-init.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$SCRIPT_DIR/base"
OVERLAY_DIR="$SCRIPT_DIR/overlays/prod"
SECRETS_FILE="$BASE_DIR/secrets.env"
KUSTOMIZATION_FILE="$OVERLAY_DIR/kustomization.yaml"
NAMESPACE="price-tracker"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!!\033[0m %s\n' "$1"; }
err()  { printf '\033[31mERREUR:\033[0m %s\n' "$1" >&2; }

ask() {
  # ask <var> <prompt> [default]
  local __var="$1" __prompt="$2" __default="${3:-}" __reply
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
  local __prompt="$1" __reply
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
bold "=== Installation interactive de price-tracker (Kubernetes) ==="
echo

require_cmd kubectl
require_cmd openssl

# ---------------------------------------------------------------------------
info "Étape 0 — Contexte kubectl"
CURRENT_CTX="$(kubectl config current-context 2>/dev/null || echo '<aucun>')"
echo "Contexte kubectl actif : $CURRENT_CTX"
if ! confirm "Continuer l'installation sur ce contexte ?"; then
  err "Installation annulée. Change de contexte avec 'kubectl config use-context <ctx>' puis relance le script."
  exit 1
fi

# ---------------------------------------------------------------------------
info "Étape 1 — Owner GitHub des images GHCR et domaine"
ask GITHUB_OWNER "Owner GitHub des images (ghcr.io/<owner>/item_scrapper-*)"
ask DOMAIN "Domaine public du frontend (ex: prices.mondomaine.com)"

if grep -q "YOUR_GITHUB_USERNAME" "$KUSTOMIZATION_FILE" 2>/dev/null; then
  sed -i "s/YOUR_GITHUB_USERNAME/${GITHUB_OWNER}/g" "$KUSTOMIZATION_FILE"
  info "Owner GHCR écrit dans $KUSTOMIZATION_FILE"
else
  warn "Placeholder YOUR_GITHUB_USERNAME absent de $KUSTOMIZATION_FILE (déjà édité ?) — vérifie manuellement."
fi

if grep -q "prices.example.com" "$KUSTOMIZATION_FILE" 2>/dev/null; then
  sed -i "s/prices.example.com/${DOMAIN}/g" "$KUSTOMIZATION_FILE"
  info "Domaine écrit dans $KUSTOMIZATION_FILE"
else
  warn "Placeholder prices.example.com absent de $KUSTOMIZATION_FILE (déjà édité ?) — vérifie manuellement."
fi

# ---------------------------------------------------------------------------
info "Étape 2 — Packages GHCR privés ?"
PULL_SECRET_NEEDED=false
if confirm "Les packages ghcr.io/${GITHUB_OWNER}/item_scrapper-* sont-ils privés ?"; then
  PULL_SECRET_NEEDED=true
  ask GHCR_USERNAME "Username GitHub"
  ask_secret GHCR_TOKEN "Personal Access Token GitHub (scope read:packages)"
fi

# ---------------------------------------------------------------------------
info "Étape 3 — Secrets applicatifs (k8s/base/secrets.env)"
if [[ -f "$SECRETS_FILE" ]]; then
  warn "$SECRETS_FILE existe déjà."
  if ! confirm "L'écraser avec de nouvelles valeurs saisies maintenant ?"; then
    info "Conservation du secrets.env existant."
    SKIP_SECRETS=true
  fi
fi
SKIP_SECRETS="${SKIP_SECRETS:-false}"

if [[ "$SKIP_SECRETS" == "false" ]]; then
  ask MONGODB_URI "MONGODB_URI (Mongo externe, ex: mongodb+srv://user:pass@host/scrapper)"
  ask AIRFLOW_DB_USER "AIRFLOW_DB_USER (Postgres interne Airflow)" "airflow"
  ask_secret AIRFLOW_DB_PASSWORD "AIRFLOW_DB_PASSWORD"
  ask AIRFLOW_ADMIN_USERNAME "AIRFLOW_ADMIN_USERNAME (compte admin webui Airflow)" "admin"
  ask_secret AIRFLOW_ADMIN_PASSWORD "AIRFLOW_ADMIN_PASSWORD"

  GENERATED_FERNET_KEY="$(gen_fernet_key)"
  ask_secret AIRFLOW_FERNET_KEY "AIRFLOW_FERNET_KEY" "$GENERATED_FERNET_KEY"

  GENERATED_SECRET_KEY="$(gen_hex_key)"
  ask_secret AIRFLOW_SECRET_KEY "AIRFLOW_SECRET_KEY" "$GENERATED_SECRET_KEY"

  AIRFLOW_SQL_ALCHEMY_CONN="postgresql+psycopg2://${AIRFLOW_DB_USER}:${AIRFLOW_DB_PASSWORD}@airflow-postgres/airflow"

  umask 077
  cat > "$SECRETS_FILE" <<EOF
MONGODB_URI=${MONGODB_URI}

AIRFLOW_DB_USER=${AIRFLOW_DB_USER}
AIRFLOW_DB_PASSWORD=${AIRFLOW_DB_PASSWORD}
AIRFLOW_SQL_ALCHEMY_CONN=${AIRFLOW_SQL_ALCHEMY_CONN}

AIRFLOW_ADMIN_USERNAME=${AIRFLOW_ADMIN_USERNAME}
AIRFLOW_ADMIN_PASSWORD=${AIRFLOW_ADMIN_PASSWORD}

AIRFLOW_FERNET_KEY=${AIRFLOW_FERNET_KEY}
AIRFLOW_SECRET_KEY=${AIRFLOW_SECRET_KEY}
EOF
  chmod 600 "$SECRETS_FILE"
  info "$SECRETS_FILE écrit (permissions 600, non commité — vérifie .gitignore)."
fi

# ---------------------------------------------------------------------------
info "Étape 4 — Namespace et pull secret GHCR"
if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  info "Namespace '$NAMESPACE' déjà présent."
else
  if confirm "Créer le namespace '$NAMESPACE' ?"; then
    kubectl create namespace "$NAMESPACE"
  else
    err "Le namespace est requis pour la suite. Installation annulée."
    exit 1
  fi
fi

if [[ "$PULL_SECRET_NEEDED" == "true" ]]; then
  if kubectl -n "$NAMESPACE" get secret ghcr-pull-secret >/dev/null 2>&1; then
    if confirm "Le secret 'ghcr-pull-secret' existe déjà — le recréer ?"; then
      kubectl -n "$NAMESPACE" delete secret ghcr-pull-secret
      kubectl create secret docker-registry ghcr-pull-secret \
        --namespace "$NAMESPACE" \
        --docker-server=ghcr.io \
        --docker-username="$GHCR_USERNAME" \
        --docker-password="$GHCR_TOKEN"
    fi
  else
    kubectl create secret docker-registry ghcr-pull-secret \
      --namespace "$NAMESPACE" \
      --docker-server=ghcr.io \
      --docker-username="$GHCR_USERNAME" \
      --docker-password="$GHCR_TOKEN"
  fi
  info "Pull secret 'ghcr-pull-secret' prêt."
fi

# ---------------------------------------------------------------------------
info "Étape 5 — Application des manifests (kubectl apply -k k8s/overlays/prod)"
bold "Récapitulatif avant apply :"
echo "  Contexte kubectl : $CURRENT_CTX"
echo "  Namespace         : $NAMESPACE"
echo "  Owner GHCR        : $GITHUB_OWNER"
echo "  Domaine            : $DOMAIN"
echo "  secrets.env        : $([[ "$SKIP_SECRETS" == "true" ]] && echo "conservé" || echo "régénéré")"
if ! confirm "Lancer 'kubectl apply -k k8s/overlays/prod' maintenant ?"; then
  warn "Apply non lancé. Tu peux le faire manuellement plus tard avec :"
  echo "    kubectl apply -k $OVERLAY_DIR"
  exit 0
fi

kubectl apply -k "$OVERLAY_DIR"

# ---------------------------------------------------------------------------
info "Étape 6 — Vérification du Job airflow-init"
echo "Attente de la complétion du Job (jusqu'à 2 minutes)..."
if kubectl -n "$NAMESPACE" wait --for=condition=complete job/airflow-init --timeout=120s 2>/dev/null; then
  info "airflow-init terminé avec succès."
else
  warn "airflow-init n'a pas atteint l'état 'complete' dans le délai. Logs :"
  kubectl -n "$NAMESPACE" logs job/airflow-init --tail=50 || true
fi

# ---------------------------------------------------------------------------
echo
bold "=== Installation terminée ==="
echo "Vérifie l'état du cluster avec :"
echo "    kubectl -n $NAMESPACE get pods"
echo "    kubectl -n $NAMESPACE get ingress"
echo
echo "Pour mettre à jour après un nouveau build d'image :"
echo "    kubectl -n $NAMESPACE rollout restart deployment price-tracker-frontend"
echo "    kubectl -n $NAMESPACE rollout restart deployment airflow-webserver"
echo "    kubectl -n $NAMESPACE rollout restart deployment airflow-scheduler"
