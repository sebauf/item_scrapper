import { Keyword } from '../domain/keyword';
import { KeywordName } from '../domain/keyword-name';
import { KeywordRepository } from '../domain/keyword.repository';

/**
 * Double de test du port de persistance.
 *
 * C'est le bénéfice concret d'avoir défini un port dans le domaine : les tests
 * des use cases tournent en millisecondes, sans base ni conteneur, et vérifient
 * la logique plutôt que le driver Mongo.
 */
export class InMemoryKeywordRepository extends KeywordRepository {
  private readonly store = new Map<string, boolean>();

  constructor(initial: Record<string, boolean> = {}) {
    super();
    for (const [name, tracked] of Object.entries(initial)) this.store.set(name, tracked);
  }

  findByName(name: KeywordName): Promise<Keyword | null> {
    const tracked = this.store.get(name.value);
    return Promise.resolve(tracked === undefined ? null : Keyword.rehydrate(name, tracked));
  }

  save(keyword: Keyword): Promise<void> {
    this.store.set(keyword.name.value, keyword.isTracked);
    return Promise.resolve();
  }

  /** Helper d'assertion : état persisté d'un mot-clé. */
  stateOf(name: string): boolean | undefined {
    return this.store.get(name);
  }
}
