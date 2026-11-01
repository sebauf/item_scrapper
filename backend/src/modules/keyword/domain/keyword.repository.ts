import { UserId } from 'src/shared/domain/user-id';
import { Keyword } from './keyword';
import { KeywordName } from './keyword-name';

/**
 * Port de persistance de l'agrégat Keyword.
 *
 * Déclaré en `abstract class` et non en `interface` : une interface TypeScript
 * disparaît à la compilation, elle ne peut donc pas servir de jeton
 * d'injection. Une classe abstraite donne les deux à la fois — le contrat pour
 * le compilateur, et un jeton utilisable tel quel par le conteneur NestJS :
 *
 *     { provide: KeywordRepository, useClass: MongoKeywordRepository }
 *
 * Le domaine déclare ce dont il a besoin ; l'infrastructure s'y conforme.
 * Aucune notion de MongoDB ne remonte ici.
 */
export abstract class KeywordRepository {
  /**
   * Le mot-clé vu par `owner` : suivi s'il en est abonné, non suivi sinon.
   * `null` seulement si **personne** n'a jamais suivi ce terme.
   */
  abstract findByName(owner: UserId, name: KeywordName): Promise<Keyword | null>;

  /** Nombre de mots-clés que suit `owner` — pour le quota. */
  abstract countTrackedBy(owner: UserId): Promise<number>;

  /** Persiste l'abonnement de `keyword.owner`, sans toucher à ceux des autres. */
  abstract save(keyword: Keyword): Promise<void>;
}
