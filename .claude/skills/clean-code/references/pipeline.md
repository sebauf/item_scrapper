# Pipeline — Python 3, pandas, numpy, scikit-learn, pymongo

## Organisation

```
src/pipeline.py              point d'entrée : purge → refine → score
src/config.py                DB_NAME, mongodb_uri() (lue à l'appel, pas à l'import)
src/database.py              open_database() — seul endroit qui ouvre une connexion
src/clock.py                 naive_utc_now() — convention UTC naïf de la base
src/maintenance/, refine/, scoring/, reports/   chaîne Amazon
src/fuel/                    import carburants (import_job), alertes (alerts/),
                             modèles de rupture / réapprovisionnement
```

Propriétaires uniques côté carburants : `fuel/fuels.py` (codes, libellés,
**ordre** — c'est l'encodage de la variable `fuel` des modèles, on n'ajoute
qu'à la fin), `fuel/favorites.py` (une favorite sans `userId` n'appartient à
personne), `shortage_forecast/event_search.py` (comptages par recherche
dichotomique, partagés par les deux modèles).

Chaque module exécutable a son `if __name__ == "__main__":` et se lance par
`python -m src.<chemin>` ; la logique vit dans des fonctions importables, pas
dans le bloc `__main__`, qui se limite à `with open_database() as db:` et un
appel.

## Règles propres au pipeline

- **La base est un paramètre.** Une fonction qui lit ou écrit Mongo reçoit
  `db: Database` (`purge_dead_products(db)`, `score(db)`) ; elle n'ouvre pas sa
  propre connexion — seuls les points d'entrée appellent `open_database()`.
  C'est ce qui permet aux tests de lui passer un `mongomock`.
- **L'horloge est un paramètre** dès qu'une règle dépend de la date :
  `now: datetime | None = None`, avec `naive_utc_now()` par défaut côté
  carburants (`import_stations`, `save_model`) — la chaîne Amazon garde
  `datetime.now(timezone.utc)` (`score`, `build_price_history`). Un
  `datetime.now()` enfoui dans une règle la rend intestable.
- **Séparer lecture, règle et écriture** : `parse_*` / `detect_*` / `format_*`
  purs, encadrés par une fonction d'orchestration qui fait les I/O
  (`import_stations`, `alerts/notify`). Un constat si une règle fait aussi un
  `update_many`.
- **Une seule fonction de features pour l'entraînement et la prédiction**
  (`shortage_forecast/features.py`). Toute logique de feature dupliquée côté
  service est un risque de fuite ou de divergence : « à corriger ».
- **Ne lire que le passé de `t`** dans une feature ; un test de fuite existe,
  l'étendre à toute nouvelle feature.
- **Seuils en constantes de module** en MAJUSCULES, avec leur unité et leur
  origine en commentaire (`HAMPEL_K`, `MIN_BAND_PCT`, `PURGE_AFTER_DAYS`,
  `PRESUMED_SHORTAGE_MAX_DAYS`). Un seuil partagé avec le backend (fenêtre de
  fraîcheur, âge maximal d'une prévision) est rappelé des deux côtés.
- **Erreurs** : une exception nommée pour un refus prévu
  (`TruncatedFeedError`), qui ne touche à rien avant d'être levée. Un
  `except Exception` large n'est admis qu'à une frontière où l'échec ne doit
  pas tout arrêter, **avec journalisation et la raison sur la ligne** :
  `except Exception as error:  # noqa: BLE001 — l'import des prix prime sur l'alerte`.
  Sans raison ou sans log, c'est un constat.
- **Seule la purge supprime des données** de la chaîne Amazon. Un nouveau
  `delete_*` ailleurs mérite une justification écrite.
- Annotations de type sur les fonctions publiques ; `X | None` plutôt
  qu'`Optional[X]` (style du dépôt).
- Pas de `print` de donnée personnelle : passer par `mask_phone` ou équivalent.

## pandas / agrégations

- Nommer les colonnes par des constantes quand elles sont réutilisées
  (`PRICE_COLUMN`) plutôt que de répéter la chaîne.
- Préférer une opération vectorisée nommée à une boucle sur les lignes, sauf si
  la boucle se lit mieux et que le volume est petit (dire pourquoi).
- Une agrégation Mongo se garde d'un bloc quand elle se lit d'un bloc ;
  extraire une étape seulement si elle est réutilisée ou testée isolément.

## Exceptions assumées propres au pipeline

| Ce qu'on voit | Pourquoi ne pas le « corriger » |
|---|---|
| `ShortageModel` et `_logit` dans `shortage_forecast/model.py`, nom « rupture » aussi pour le modèle de réapprovisionnement | Le pickle en service désigne cette classe par son chemin : la renommer ou la déplacer rend les modèles illisibles jusqu'au prochain entraînement. |
| `compute_features` (rupture et réapprovisionnement) de ~60 lignes | Une quinzaine d'intermédiaires partagés ; découper par famille de variables demanderait un objet de contexte et disperserait « indexer, puis compter ». Raison écrite dans la docstring du module. |
| Imports de `model` / `predict` à l'intérieur des `try` de `publish_*` | Un scikit-learn absent ou cassé ne doit pas faire échouer l'import des prix. |
| `python -m src.fuel.import_stations` qui délègue à `import_job.main` | Point d'entrée du DAG conservé : images Airflow et pipeline déployables séparément. |
| Docstrings de module longues, en partie en anglais, en partie en français | Elles exposent la méthode (filtre de Hampel, Theil–Sen, calibration de Platt) et ses mesures ; les raccourcir, oui, perdre la justification, non. Ne pas « harmoniser » la langue dans un diff sans rapport. |
| Échec d'envoi d'alerte attrapé et journalisé | Une alerte ratée ne doit pas faire échouer l'import des prix ; l'état n'est pas avancé, l'alerte est retentée. |
| Modèles stockés en pickle dans Mongo, `scikit-learn` épinglé | Choix documenté (pas de PVC) ; le pickle n'est lisible que par la version qui l'a écrit. |
| `DB_NAME = "scrapper"` en dur | Nom de base unique du projet, partagé par tous les composants. |

## Tests (`pytest`, `python -m pytest`)

- Fixtures communes dans `tests/conftest.py` (`db` = `mongomock` neuf,
  `today`, `snapshot`, `money`) : les réutiliser plutôt que d'en recréer.
- **Exécuter les vraies agrégations** sur `mongomock` ; ne pas remplacer une
  agrégation par un mock de son résultat.
- Classes de tests par fonctionnalité, méthodes nommées en français, décrivant
  le comportement : `test_produit_relevé_hier_reste_eligible`,
  `test_trop_peu_d_observations`.
- Aucun test n'accède au réseau : les téléchargements (flux carburants, archive,
  export OSM) sont simulés à leur frontière, par `monkeypatch` de `urlopen`
  dans le module testé (`test_import_stations.py`, `test_brands.py`).
