"""Prévision des ruptures de carburant à 24 heures.

Vue d'ensemble — le détail est dans la docstring de chaque module :

- `archive`  : lit les archives annuelles officielles (toutes les ruptures et
  tous les changements de prix de l'année, station par station) ;
- `history`  : représentation commune de l'historique, construite soit depuis
  ces archives (entraînement), soit depuis MongoDB (prévision en direct) ;
- `features` : variables explicatives d'un couple (station × carburant) à un
  instant donné — **une seule fonction** pour l'entraînement et la prévision,
  de sorte que le modèle voie en production exactement ce qu'il a appris ;
- `dataset`  : instantanés étiquetés « une rupture commence dans les 24 h » ;
- `model`    : entraînement, validation temporelle, stockage dans MongoDB ;
- `episodes` : collection `fuel_shortages`, tenue à jour par l'import toutes
  les 30 minutes et resynchronisée sur l'archive à chaque entraînement ;
- `train`    : point d'entrée de la tâche quotidienne ;
- `predict`  : risque en direct d'une liste de couples (station × carburant) ;
- `forecasts`: risque des stations favorites, publié après chaque import dans
  `fuel_shortage_forecasts` (lu par le backend) et relu par les alertes.
"""
