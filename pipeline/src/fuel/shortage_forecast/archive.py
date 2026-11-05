"""Archives annuelles officielles des prix des carburants.

Source : https://donnees.roulez-eco.fr/opendata/annee/<année>, l'export
historique du ministère (même base de déclarations que le flux instantané lu
par import_stations.py, même Licence Ouverte). Un zip par année, d'environ
30 Mo, qui contient un XML de 350 Mo. L'archive de l'**année en cours** est
régénérée chaque nuit : c'est elle qui donne les dernières semaines.

Pour chaque point de vente, l'archive liste :

- chaque **changement de prix** (`<prix nom maj valeur>`), soit environ
  5 millions par an. On n'en garde que les dates, par (station × carburant) :
  elles disent quand le carburant est vendu, et depuis quand son prix n'a pas
  bougé ;
- chaque **rupture** (`<rupture nom debut fin type>`), avec sa date de fin
  quand elle est close. Les ruptures `definitive` (carburant retiré de la
  vente) ne sont pas des ruptures de stock et sont écartées. Le type est vide
  dans les archives antérieures à 2025 : il est alors lu comme temporaire, et
  la règle « début dans la période couverte » écarte d'elle-même les retraits
  définitifs, qui datent souvent de plusieurs années.

**Fuseau horaire.** Les dates de l'archive sont en heure de Paris, sans
mention du fuseau (les changements de prix automatiques tombent à 00:37, pas
à 22:37). Elles sont converties ici en UTC naïf, la convention de toute la
base — le flux instantané est d'ailleurs lu avec `timezone=UTC`.

Le XML est lu en flux (`iterparse`, chaque `<pdv>` libéré après lecture), sans
être décompressé sur disque : la tâche tient dans quelques centaines de Mo.
"""
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

ARCHIVE_URL = "https://donnees.roulez-eco.fr/opendata/annee/{year}"
REQUEST_TIMEOUT_SECONDS = 300

# Libellés de l'archive → codes de fuel_stations (cf. import_stations.FUELS).
FUEL_CODES = {
    "Gazole": "gazole",
    "E10": "e10",
    "SP98": "sp98",
    "SP95": "sp95",
    "E85": "e85",
    "GPLc": "gplc",
}

ARCHIVE_TZ = "Europe/Paris"

# Au-delà, une « rupture » n'est pas un manque de stock (cf. parse_archive).
MAX_SHORTAGE_DAYS = 30


@dataclass
class Archive:
    """Contenu utile d'une ou plusieurs archives annuelles.

    - `stations` : `station`, `dept`, `pop` (R/A) ;
    - `shortages` : `station`, `fuel`, `start`, `end` (NaT si non close) ;
    - `prices` : `station`, `fuel`, `at` — une ligne par changement de prix ;
    - `generated_at` : date la plus récente lue (UTC), c'est-à-dire la limite
      de ce que l'archive peut dire. Au-delà, l'absence de rupture ne prouve
      rien.
    """
    stations: pd.DataFrame
    shortages: pd.DataFrame
    prices: pd.DataFrame
    generated_at: datetime

    @classmethod
    def concat(cls, archives: list["Archive"]) -> "Archive":
        """Assemble plusieurs années. Une rupture à cheval sur deux années
        figure dans les deux fichiers (avec sa fin dans le second seulement) :
        on garde la version la plus complète."""
        stations = (
            pd.concat([a.stations for a in archives])
            .drop_duplicates("station", keep="last")
            .reset_index(drop=True)
        )
        shortages = pd.concat([a.shortages for a in archives], ignore_index=True)
        shortages = (
            shortages.assign(_open=shortages["end"].isna())
            .sort_values(["station", "fuel", "start", "_open"])
            .drop_duplicates(["station", "fuel", "start"], keep="first")
            .drop(columns="_open")
            .reset_index(drop=True)
        )
        prices = (
            pd.concat([a.prices for a in archives], ignore_index=True)
            .drop_duplicates()
            .reset_index(drop=True)
        )
        return cls(stations, shortages, prices, max(a.generated_at for a in archives))


def department(postcode: str | None) -> str:
    """`69003` → `69`. La Corse (`20xxx`) reste `20` : le flux ne distingue
    pas 2A et 2B, et le découpage n'a qu'à regrouper des voisins."""
    postcode = (postcode or "").strip()
    return postcode[:2] if len(postcode) >= 2 else "??"


def paris_to_utc(values: pd.Series) -> pd.Series:
    """Dates locales de Paris (texte) → datetime64 UTC naïf.

    Au passage à l'heure d'hiver, 02:00-03:00 existe deux fois : on prend la
    première (heure d'été) plutôt que de perdre la date. Au passage à l'heure
    d'été, 02:00-03:00 n'existe pas : on avance à 03:00.
    """
    parsed = pd.to_datetime(values.replace("", None), errors="coerce", format="ISO8601")
    localized = parsed.dt.tz_localize(ARCHIVE_TZ, ambiguous=np.ones(len(parsed), dtype=bool),
                                      nonexistent="shift_forward")
    return localized.dt.tz_convert("UTC").dt.tz_localize(None)


def parse_archive(source) -> Archive:
    """Lit un XML d'archive (chemin ou objet fichier binaire)."""
    station_rows, shortage_rows, price_rows = [], [], []
    for _, element in ET.iterparse(source, events=("end",)):
        if element.tag != "pdv":
            continue
        station = element.get("id")
        station_rows.append((station, department(element.get("cp")), element.get("pop")))
        for child in element:
            fuel = FUEL_CODES.get(child.get("nom") or "")
            if fuel is None:
                continue
            if child.tag == "prix":
                if child.get("maj"):
                    price_rows.append((station, fuel, child.get("maj")))
            elif child.tag == "rupture":
                if (child.get("type") or "temporaire") == "temporaire" and child.get("debut"):
                    shortage_rows.append((station, fuel, child.get("debut"), child.get("fin") or ""))
        element.clear()

    stations = pd.DataFrame(station_rows, columns=["station", "dept", "pop"])
    stations["pop"] = stations["pop"].where(stations["pop"].isin(["R", "A"]), None)

    prices = pd.DataFrame(price_rows, columns=["station", "fuel", "at"])
    prices["at"] = paris_to_utc(prices["at"])
    prices = prices.dropna(subset=["at"])

    shortages = pd.DataFrame(shortage_rows, columns=["station", "fuel", "start", "end"])
    shortages["start"] = paris_to_utc(shortages["start"])
    shortages["end"] = paris_to_utc(shortages["end"])
    shortages = shortages.dropna(subset=["start"])

    # Une fin antérieure au début est une saisie erronée : la rupture reste
    # comptée, mais comme non close.
    shortages.loc[shortages["end"] < shortages["start"], "end"] = pd.NaT

    # La période couverte : du premier au dernier changement de prix lu.
    covered_from = prices["at"].min() if len(prices) else pd.Timestamp.max
    generated_at = max(
        prices["at"].max() if len(prices) else pd.Timestamp.min,
        shortages["start"].max() if len(shortages) else pd.Timestamp.min,
    )
    # Une rupture de stock dure des heures ou des jours. Au-delà d'un mois,
    # c'est un retrait de la vente qui ne dit pas son nom (archives sans type)
    # ou une rupture jamais close par la station : ni l'un ni l'autre ne
    # renseigne sur le prochain réapprovisionnement.
    longest = pd.Timedelta(days=MAX_SHORTAGE_DAYS)
    too_long = (shortages["end"] - shortages["start"]) > longest
    stale_open = shortages["end"].isna() & (shortages["start"] < covered_from - longest)
    shortages = shortages[~too_long & ~stale_open]

    return Archive(
        stations=stations.drop_duplicates("station").reset_index(drop=True),
        shortages=shortages.drop_duplicates(["station", "fuel", "start"]).reset_index(drop=True),
        prices=prices.reset_index(drop=True),
        generated_at=pd.Timestamp(generated_at).to_pydatetime(),
    )


def download_archive(year: int, directory: Path) -> Path:
    """Télécharge le zip d'une année ; renvoie son chemin."""
    request = Request(ARCHIVE_URL.format(year=year), headers={"Accept": "application/zip"})
    path = directory / f"prix-carburants-{year}.zip"
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response, path.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    return path


def read_zip(path: Path) -> Archive:
    """Lit le XML contenu dans le zip, sans l'extraire sur disque."""
    with zipfile.ZipFile(path) as archive:
        members = [name for name in archive.namelist() if name.lower().endswith(".xml")]
        if len(members) != 1:
            raise ValueError(f"{path.name} : un XML attendu, {len(members)} trouvé(s)")
        with archive.open(members[0]) as xml:
            return parse_archive(xml)


def fetch_archives(years: list[int]) -> Archive:
    """Télécharge et assemble les archives des années demandées."""
    with tempfile.TemporaryDirectory() as tmp:
        archives = []
        for year in years:
            path = download_archive(year, Path(tmp))
            archive = read_zip(path)
            print(f"archive {year}: {len(archive.stations)} stations, "
                  f"{len(archive.shortages)} ruptures, {len(archive.prices)} prix")
            archives.append(archive)
    return Archive.concat(archives)
