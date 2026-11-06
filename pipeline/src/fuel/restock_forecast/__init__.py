"""Prévision des réapprovisionnements de carburant à 24 heures.

Le miroir de `src.fuel.shortage_forecast` : là où celui-ci répond, pour un
carburant **disponible**, à « une rupture commence-t-elle dans les 24 h ? »,
celui-ci répond, pour un carburant **en rupture**, à « la rupture se
termine-t-elle — le carburant revient-il à la pompe — dans les 24 h ? ».

Tout ce qui peut être partagé l'est, pour que les deux modèles voient le même
monde :

- même historique (`History`, lu dans l'archive à l'entraînement, dans
  `fuel_shortages` / `fuel_stations` en direct) ;
- mêmes variables de contexte (`shortage_forecast.features.compute_features`),
  complétées de celles qui n'ont de sens que pendant une rupture ;
- même mécanique d'entraînement, de validation temporelle, de garde-fou et de
  stockage (`shortage_forecast.model`, paramétrée par un `ModelSpec`).

Modules :

- `features` : variables propres au réapprovisionnement (âge de la rupture,
  durée habituelle des ruptures du couple, fins de rupture récentes autour) ;
- `dataset`  : instantanés **pendant** une rupture, étiquetés « elle se
  termine dans les 24 h » ;
- `model`    : le `ModelSpec` du réapprovisionnement et sa méthode naïve ;
- `train`    : entraînement, appelé par la tâche quotidienne de
  `shortage_forecast.train` (une seule lecture de l'archive pour les deux) ;
- `forecasts`: probabilité de réapprovisionnement des carburants en rupture
  des stations favorites, publiée après chaque import dans
  `fuel_restock_forecasts` (lue par le backend, page « Mes stations »).
"""
