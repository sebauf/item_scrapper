"""Les carburants suivis : propriétaire unique des codes et libellés du pipeline.

Les codes sont ceux de `fuel_stations.fuels[].code` et des colonnes de l'API
(`gazole_prix`…), repris tels quels par le backend (`fuel/domain/fuel-type.ts`).

L'ordre compte deux fois :

- c'est l'ordre d'affichage, du plus vendu au plus rare ;
- c'est **l'encodage de la variable `fuel` des modèles** (son rang dans
  `FUELS`, cf. `shortage_forecast.features`). Réordonner fausserait sans
  erreur les modèles en service — `load_model` vérifie les noms des
  variables, pas leur encodage. Un nouveau carburant s'ajoute à la fin, et
  les modèles se réentraînent.
"""
FUEL_LABELS = {
    "gazole": "Gazole",
    "e10": "SP95-E10",
    "sp98": "SP98",
    "sp95": "SP95",
    "e85": "E85",
    "gplc": "GPLc",
}

FUELS = tuple(FUEL_LABELS)

FUEL_RANK = {code: rank for rank, code in enumerate(FUELS)}
