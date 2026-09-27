import { KeywordName } from '../../domain/keyword-name';

/**
 * Le mot-clé a-t-il des relevés exploitables dans `items_raw` ?
 *
 * Ce port existe pour une seule décision, celle d'`UntrackKeywordCommand` :
 * distinguer un mot-clé **inconnu** (un nom appelé par erreur → 404) d'un
 * mot-clé que la page liste sans qu'il ait de document dans `keywords` (scrapé
 * avant que la collection n'existe, cf. `trackedKeywordNames` cas 2). Le second
 * est légitimement retirable ; le premier n'a rien à retirer.
 *
 * « Exploitable » a exactement le sens qu'il a côté lecture : c'est le même
 * prédicat (`USABLE_SCRAPE_MATCH`), sinon on pourrait refuser de retirer un
 * mot-clé pourtant affiché.
 */
export abstract class ScrapedKeywords {
  abstract has(name: KeywordName): Promise<boolean>;
}
