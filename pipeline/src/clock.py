"""Horloge du pipeline."""
from datetime import datetime, timezone


def naive_utc_now() -> datetime:
    """Maintenant, en UTC **naïf** : la convention de toute la base.

    pymongo relit les dates sans fuseau ; comparer l'une d'elles à un
    `datetime` avec fuseau lèverait une TypeError. À n'appeler qu'en valeur par
    défaut d'un paramètre `now`, ou dans un point d'entrée : une règle qui lit
    l'horloge elle-même n'est plus testable.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
