"""Envoi d'une alerte : corps du webhook, signature Hermes « Generic V2 », POST.

Signature : `X-Webhook-Signature-V2` = HMAC-SHA256 hexadécimal de
`<timestamp>.<corps>`, `X-Webhook-Timestamp` en secondes Unix (cf. la
docstring du paquet).
"""
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from src.fuel.alerts.detection import EVENT_TYPES, RESTOCK, RISK, SHORTAGE
from src.fuel.alerts.messages import alert_summary
from src.fuel.alerts.subscribers import Subscriber

REQUEST_TIMEOUT_SECONDS = 10

# Clé de la liste détaillée dans le corps du webhook.
PAYLOAD_LISTS = {RESTOCK: "restocks", SHORTAGE: "shortages", RISK: "risks"}


def build_payload(subscriber: Subscriber, events: list[dict], imported_at: datetime, kind: str) -> dict:
    """Corps du webhook. L'adresse e-mail de l'utilisateur n'y figure pas :
    l'agent n'a besoin que du numéro où envoyer le message."""
    return {
        # Champ lu par Hermes pour filtrer les routes par `events`.
        "event_type": EVENT_TYPES[kind],
        "importedAt": imported_at,
        # Destinataire, au format E.164 — `deliver_extra.chat_id: "{to}"`
        # pour le SMS (Twilio) ou Signal.
        "to": subscriber.phone,
        # Même destinataire, sous la forme d'un identifiant de discussion
        # WhatsApp (pont Baileys de Hermes : indicatif sans « + », suffixe
        # `@s.whatsapp.net`) — `deliver_extra.chat_id: "{whatsappChatId}"`.
        "whatsappChatId": whatsapp_chat_id(subscriber.phone),
        "fuels": list(subscriber.fuels),
        "count": len(events),
        "summary": alert_summary(kind, events),
        PAYLOAD_LISTS[kind]: events,
    }


def whatsapp_chat_id(phone: str) -> str:
    """`+33612345678` → `33612345678@s.whatsapp.net`.

    Un gabarit Hermes ne sait que recopier un champ, pas le transformer : la
    conversion est donc faite ici, une fois pour toutes les routes WhatsApp.
    """
    return f"{phone.removeprefix('+')}@s.whatsapp.net"


def request_id(subscriber: Subscriber, imported_at: datetime, kind: str) -> str:
    """Dérivé de l'import **et** du destinataire : Hermes ignore un
    identifiant déjà vu dans l'heure, donc un double envoi du même import ne
    notifie qu'une fois, sans pour autant confondre deux destinataires.
    Le type d'événement aussi : une rupture et un risque du même import sont
    deux messages. L'utilisateur y figure haché — l'en-tête finit dans les
    journaux de l'agent. Le renvoi d'une alerte échouée, à l'import suivant,
    porte un nouvel identifiant : c'est voulu, Hermes ne doit pas le dédupliquer.
    """
    user = hashlib.sha256(subscriber.user_id.encode()).hexdigest()[:12]
    slug = EVENT_TYPES[kind].removeprefix("fuel_").replace("_", "-")
    return f"fuel-{slug}-{imported_at:%Y%m%dT%H%M%S}-{user}"


def sign(secret: str, timestamp: int, body: bytes) -> str:
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def send_webhook(url: str, secret: str, payload: dict, request_id: str) -> int:
    """POST signé ; renvoie le statut HTTP, lève sur une erreur réseau ou ≥ 400."""
    body = json.dumps(payload, default=_json_default, ensure_ascii=False).encode()
    timestamp = int(time.time())
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Timestamp": str(timestamp),
            "X-Webhook-Signature-V2": sign(secret, timestamp, body),
            "X-Request-ID": request_id,
        },
    )
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return response.status


def _json_default(value: object) -> str:
    """Dates de la base (UTC naïf) → ISO 8601 avec fuseau."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()
    raise TypeError(f"{type(value).__name__} non sérialisable")
