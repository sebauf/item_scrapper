import { Db, Document } from 'mongodb';

/**
 * Fraîcheur des écrans : on n'affiche que ce que le **dernier passage du
 * scrapper** a rafraîchi.
 *
 * `items_raw` porte un document par (url, jour) et `day` est minuit UTC du
 * relevé. Le jour le plus récent de la collection est donc la date du dernier
 * passage ; un produit sans relevé ce jour-là est un produit que le scrapper
 * n'a pas réussi à revoir — page morte, redirection, blocage. Son dernier prix
 * connu n'est plus un prix, c'est un souvenir, et il n'a rien à faire dans une
 * liste de bonnes affaires.
 *
 * Ce raisonnement ne tient que parce que le budget de crawl couvre tout le
 * catalogue à chaque exécution (`MAX_REQUESTS_PER_CRAWL`, cf.
 * scrapper/README.md). Si le budget redevenait trop court, les relectures
 * tourneraient d'un jour sur l'autre et ce filtre masquerait des fiches bien
 * vivantes : les deux réglages se tiennent, on ne touche pas à l'un sans
 * l'autre.
 *
 * Corollaire assumé : pendant qu'un scrape tourne, seuls les produits déjà
 * relus du jour sont visibles — l'affichage se remplit au fil du passage.
 */
export async function findLastScrapeDay(db: Db): Promise<Date | null> {
  const doc = await db
    .collection<{ day?: Date }>('items_raw')
    .findOne({}, { sort: { day: -1 }, projection: { day: 1 } });

  return doc?.day ?? null;
}

/**
 * Restreint un filtre sur `items_raw` au dernier passage du scrapper.
 *
 * La contrainte entre dans le `$match` d'entrée, jamais dans un étage tardif :
 * l'index `items_raw.day_desc` réduit alors le pipeline à la tranche du jour au
 * lieu de lui faire balayer tout l'historique.
 *
 * `day` écrase une éventuelle contrainte de même nom de l'appelant : la
 * fraîcheur n'est pas un défaut qu'on ajuste au cas par cas, c'est la règle de
 * l'écran.
 *
 * Base vide (`null`) : aucun filtre ajouté, il n'y a de toute façon rien à
 * afficher — inutile de fabriquer une requête qui ne peut rien renvoyer.
 */
export function onlyLastScrape(match: Document, lastScrapeDay: Date | null): Document {
  return lastScrapeDay === null ? match : { ...match, day: lastScrapeDay };
}
