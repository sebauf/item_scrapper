"""Enseigne de chaque station-service, d'après OpenStreetMap.

Le flux officiel des prix ne dit pas à quelle enseigne appartient une station :
il ne donne qu'un identifiant et une adresse. OpenStreetMap, si : ses
contributeurs y étiquettent les stations avec l'identifiant officiel
(`ref:FR:prix-carburants`), à côté de `brand` et `name`. La correspondance se
fait donc **par identifiant exact**, sans rapprochement géographique approximatif.

Source : l'export CSV (compressé en bz2) de ces stations publié sur data.gouv.fr,
le même qu'utilise l'intégration Home Assistant `hass-prixcarburant`. Données ©
contributeurs OpenStreetMap, sous licence ODbL : l'attribution est obligatoire
partout où les enseignes sont affichées.

Le champ `brand` d'OSM est saisi à la main : « Total », « TotalEnergies »,
« Total Access » ou « E. Leclerc » / « E.Leclerc » désignent la même enseigne.
`BRAND_ALIASES` les ramène à un libellé unique ; une valeur absente de la table
est gardée telle quelle — c'est une table de toilettage, pas une liste blanche.
"""
import bz2
import csv
import io
import unicodedata
from urllib.request import Request, urlopen

OSM_STATIONS_URL = "https://www.data.gouv.fr/api/1/datasets/r/fcab3bd4-6c6d-4b73-95d2-cfd5e04ee651"

ID_COLUMN = "ref:FR:prix-carburants"

# L'export compte plus de 12 000 lignes. Bien moins, c'est un fichier tronqué
# ou d'un autre format : mieux vaut garder les enseignes déjà connues.
MIN_OSM_ENTRIES = 1000

REQUEST_TIMEOUT_SECONDS = 60


def _key(value: str) -> str:
    """Clé de comparaison : sans accents, ponctuation ni espaces, en minuscules.

    « E. Leclerc », « E.Leclerc » et « e leclerc » donnent tous `eleclerc`.
    """
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in decomposed if ch.isalnum()).casefold()


_ALIASES_BY_LABEL = {
    "TotalEnergies": [
        "TotalEnergies", "Total", "Total Access", "Total Contact",
        "TotalEnergies Access", "TotalEnergies Contact", "Total Excellium",
    ],
    "E.Leclerc": ["E.Leclerc", "Leclerc"],
    "Intermarché": [
        "Intermarché", "Intermarché Contact", "Intermarché Super",
        "Intermarché Express", "Intermarché Hyper",
    ],
    "Carrefour": ["Carrefour", "Carrefour Market", "Carrefour Contact", "Carrefour Express"],
    # Super U, Hyper U, U Express… : une seule enseigne, Système U (« Coopérative U »).
    "Système U": ["Système U", "Super U", "Hyper U", "U Express", "U", "Station U", "La Station U"],
    "Esso": ["Esso", "Esso Express"],
    "Avia": ["Avia", "Avia Xpress"],
    "Élan": ["Élan"],
    "AS 24": ["AS 24"],
    "Auchan": ["Auchan"],
    "BP": ["BP"],
    "Casino": ["Casino", "Géant Casino"],
    # Étiquette OSM des stations sans enseigne : c'est une information, pas un vide.
    "Indépendante": ["Independent", "Indépendant", "Indépendante"],
}

BRAND_ALIASES: dict[str, str] = {
    _key(alias): label for label, aliases in _ALIASES_BY_LABEL.items() for alias in aliases
}


def normalize_brand(raw: str | None) -> str | None:
    """Libellé d'enseigne unifié, la valeur nettoyée si inconnue, None si vide."""
    if raw is None:
        return None
    cleaned = " ".join(raw.split())
    if not cleaned:
        return None
    return BRAND_ALIASES.get(_key(cleaned), cleaned)


def parse_osm_csv(text: str) -> dict[str, dict]:
    """CSV de l'export OSM → `{identifiant officiel: {"brand", "name"}}`.

    Sans `brand`, on tente le nom : une station nommée « Intermarché » sans
    enseigne renseignée est une station Intermarché. Mais seulement si le nom
    est une enseigne connue — « Garage du Centre » n'en est pas une.

    Une ligne OSM peut porter plusieurs identifiants séparés par « ; » (une
    station déclarée deux fois au ministère) ; le premier vu l'emporte.
    """
    stations: dict[str, dict] = {}
    for row in csv.DictReader(io.StringIO(text)):
        ids = (row.get(ID_COLUMN) or "").strip()
        if not ids:
            continue

        name = " ".join((row.get("name") or "").split()) or None
        brand = normalize_brand(row.get("brand"))
        if brand is None and name is not None:
            brand = BRAND_ALIASES.get(_key(name))
        if brand is None and name is None:
            continue

        for station_id in ids.split(";"):
            station_id = station_id.strip()
            if station_id and station_id not in stations:
                stations[station_id] = {"brand": brand, "name": name}
    return stations


def fetch_osm_stations(url: str = OSM_STATIONS_URL) -> dict[str, dict]:
    """Télécharge et lit l'export OSM. Lève une erreur s'il est inexploitable.

    Le fichier est publié compressé en bz2 ; on accepte aussi un CSV en clair,
    au cas où data.gouv.fr changerait de format — la signature `BZh` décide.
    """
    request = Request(url, headers={"Accept": "text/csv, application/x-bzip2, */*"})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        raw = response.read()

    content = bz2.decompress(raw) if raw[:3] == b"BZh" else raw
    stations = parse_osm_csv(content.decode("utf-8-sig"))
    if len(stations) < MIN_OSM_ENTRIES:
        raise ValueError(f"export OSM inexploitable : {len(stations)} station(s) lue(s)")
    return stations
