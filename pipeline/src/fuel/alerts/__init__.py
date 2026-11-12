"""Alertes carburant, **par utilisateur** : préviennent chaque utilisateur,
par un message sur son téléphone, de ce qui arrive à un carburant qu'il
surveille dans l'une de ses stations favorites. Trois événements :

- **réapprovisionnement** (`fuel_restock`) : le carburant redevient disponible ;
- **rupture** (`fuel_shortage`) : il tombe en rupture ;
- **risque de rupture** (`fuel_shortage_risk`) : le modèle de
  `shortage_forecast` prévoit une rupture dans les 24 h avec une probabilité
  d'au moins `FUEL_SHORTAGE_RISK_THRESHOLD` (0,5 par défaut). Au plus une
  alerte par jour et par (station × carburant), et seulement si le modèle en
  service a moins de 7 jours. Sans modèle, les deux autres alertes continuent.

Qui reçoit quoi — trois conditions, toutes écrites par le backend :

- un **numéro** au format E.164 dans son profil (`user_profiles.phone`) ;
- au moins un **carburant** surveillé (`user_profiles.alertFuels`) ;
- au moins une **station favorite** (`favorite_stations`, étoile sur la carte).

Il manque l'une des trois, l'utilisateur n'est pas surveillé du tout. C'est la
même règle que `UserProfile.missingForFuelAlerts` côté backend, qui l'affiche
sur la page de profil ; ici, elle s'applique pour de bon. Une favorite
antérieure aux comptes (sans `userId`) n'appartient à personne et n'alerte
donc personne : le backend la rattache à `AUTH_LEGACY_OWNER_EMAIL` à son
démarrage.

L'import remplace `fuel_stations` à chaque passage (cf. import_stations.py) et
n'en garde aucun historique. Comparer à l'import précédent ne suffit pas : une
station qui clôt ses ruptures sans redéclarer de prix passe par un état « ni
prix, ni rupture », où elle (ou le carburant) disparaît de `fuel_stations` ; au
retour du prix, l'import précédent ne dit plus qu'elle était en rupture. Ce
module tient donc son propre **dernier état connu**, dans `fuel_watch_state`,
qu'il est seul à écrire, pour chaque triplet surveillé (utilisateur × station
favorite × carburant surveillé) : `_id` = `<userId>:<stationId>:<carburant>`,
`available`, `shortageSince`, `seenAt`.

Pourquoi un état par utilisateur, et pas par (station × carburant) partagé :
l'envoi est par utilisateur, et peut échouer pour l'un et réussir pour l'autre
(numéro refusé par la passerelle, par exemple). Un état partagé obligerait à
choisir entre réalerter celui qui a déjà reçu le message et perdre l'alerte de
celui qui ne l'a pas reçue. Le volume reste négligeable (quelques stations ×
quelques carburants par utilisateur).

Définition retenue : un carburant est **réapprovisionné** s'il est disponible
(`available: true`) à cet import et que son dernier état connu est « en
rupture » (`available: false`), quel que soit le nombre d'imports écoulés
entre les deux ; il est **en rupture** dans le cas inverse. L'état garde aussi
`riskAlertedAt`, la date de la dernière alerte de risque. Règles de mise à
jour, après chaque import :

- carburant présent, disponible ou non → l'état enregistré devient le sien ;
- station absente, carburant absent (non vendu) → rien ne change : un état
  ambigu n'efface jamais le dernier état connu. Un carburant vendu qui passe à
  « ni prix ni rupture » n'est plus absent : l'import le garde **en rupture
  présumée** pendant 7 jours (cf. import_stations.py), il compte donc comme
  une rupture ;
- aucun état enregistré (triplet vu pour la première fois : station mise en
  favori, carburant coché, numéro renseigné) → on l'enregistre sans alerter :
  rien ne dit qu'il était en rupture ;
- triplet qui n'est plus surveillé (favorite retirée, carburant décoché,
  numéro effacé) → son état est supprimé, sans quoi une surveillance reprise
  des mois plus tard alerterait sur un état périmé.

Configuration par l'environnement ; sans webhook, la fonctionnalité est
désactivée et l'import se comporte comme si elle n'existait pas :

- `FUEL_RESTOCK_WEBHOOK_URL` : route webhook de l'agent, par exemple
  `http://192.168.1.10:8644/webhooks/fuel-restock` ;
- `FUEL_RESTOCK_WEBHOOK_SECRET` : secret HMAC partagé avec la route.

Un **webhook par destinataire, par type d'événement** et par import, dont le
corps porte le numéro dans `to` (E.164), le message prêt à envoyer dans
`summary`, et le type dans `event_type` — une route Hermes filtre sur ce champ
(`events`) : ajoutez-y `fuel_shortage` et `fuel_shortage_risk`, ou créez une
route par type. La route Hermes
correspondante, en `deliver_only` (aucun appel au modèle) :

    deliver: "sms"            # ou signal
    deliver_only: true
    prompt: "{summary}"
    deliver_extra:
      chat_id: "{to}"

Pour WhatsApp, `deliver: "whatsapp"` et `chat_id: "{whatsappChatId}"` : le
pont de Hermes désigne une discussion par `33612345678@s.whatsapp.net`, pas
par le numéro E.164.

Signature : schéma « Generic V2 » du webhook Hermes — en-tête
`X-Webhook-Signature-V2` = HMAC-SHA256 hexadécimal de `<timestamp>.<corps>`,
et `X-Webhook-Timestamp` en secondes Unix. Hermes refuse un horodatage à plus
de 5 minutes de son horloge, ce qui bloque le rejeu d'une requête interceptée.
La signature est ce qui empêche un tiers d'utiliser la route pour envoyer des
messages à un numéro de son choix : elle est obligatoire.

Un échec d'envoi ne fait jamais échouer l'import : les prix doivent être à jour
même si l'agent est arrêté. L'état des triplets concernés reste alors celui
d'avant (« en rupture » pour un réapprovisionnement, « disponible » pour une
rupture, pas de `riskAlertedAt` pour un risque) dans l'état **de ce
destinataire seulement**, et son alerte repart à l'import suivant — toutes les
30 minutes tant que l'envoi échoue, ce qui est préférable à une alerte perdue.

Organisation du paquet — une raison de changer par module :

- `config`      : lecture de l'environnement ;
- `subscribers` : qui est surveillé (profils + favorites) ;
- `detection`   : quels événements, quel nouvel état — règle pure ;
- `messages`    : le texte envoyé ;
- `webhook`     : corps, signature et envoi HTTP ;
- `notify`      : l'enchaînement, après chaque import.
"""
from src.fuel.alerts.config import FuelAlertConfig
from src.fuel.alerts.notify import alert_fuel_events

__all__ = ["FuelAlertConfig", "alert_fuel_events"]
