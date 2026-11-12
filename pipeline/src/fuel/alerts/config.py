"""Configuration des alertes, lue dans l'environnement.

Les noms de variables gardent le préfixe `FUEL_RESTOCK_` de la première
alerte : ils sont déjà posés dans `secrets.env` et `infra/.env`.
"""
from collections.abc import Mapping
from dataclasses import dataclass

# Seuil de l'alerte de risque, réglable par FUEL_SHORTAGE_RISK_THRESHOLD. À
# 50 %, la validation d'octobre-novembre 2026 donnait : 56 % des alertes
# suivies d'une rupture dans les 24 h, 45 % des ruptures annoncées à l'avance.
# Plus haut, moins d'alertes mais plus sûres ; plus bas, l'inverse.
DEFAULT_RISK_THRESHOLD = 0.5


@dataclass(frozen=True)
class FuelAlertConfig:
    webhook_url: str
    webhook_secret: str
    # None : alerte de risque désactivée (les deux autres restent actives).
    risk_threshold: float | None = DEFAULT_RISK_THRESHOLD

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> "FuelAlertConfig | None":
        """Configuration lue dans l'environnement, ou None si désactivée.

        Une configuration incomplète désactive l'alerte avec un message, sans
        lever : une faute de frappe dans une variable ne doit pas bloquer
        l'import des prix de toute la France.
        """
        url = environ.get("FUEL_RESTOCK_WEBHOOK_URL")
        if not url:
            return None
        secret = environ.get("FUEL_RESTOCK_WEBHOOK_SECRET")
        if not secret:
            # Sans signature, n'importe qui pourrait faire envoyer un message
            # à n'importe quel numéro par la route ; Hermes rejette d'ailleurs
            # une requête non signée dès qu'un secret est configuré.
            print("restock: FUEL_RESTOCK_WEBHOOK_SECRET manquant, alerte désactivée")
            return None
        return cls(
            webhook_url=url,
            webhook_secret=secret,
            risk_threshold=parse_risk_threshold(environ.get("FUEL_SHORTAGE_RISK_THRESHOLD")),
        )


def parse_risk_threshold(raw: str | None) -> float | None:
    """`off` désactive l'alerte de risque ; une valeur hors de ]0, 1[ garde
    le défaut, avec un message, plutôt que d'alerter à tout propos (0) ou
    jamais (1)."""
    if raw is None or raw.strip() == "":
        return DEFAULT_RISK_THRESHOLD
    if raw.strip().lower() in ("off", "false", "none"):
        return None
    try:
        value = float(raw.replace(",", "."))
    except ValueError:
        value = -1
    if not 0 < value < 1:
        print(f"shortage-risk: FUEL_SHORTAGE_RISK_THRESHOLD={raw!r} invalide (attendu entre 0 et 1 "
              f"exclus, ou off), seuil par défaut {DEFAULT_RISK_THRESHOLD}")
        return DEFAULT_RISK_THRESHOLD
    return value
