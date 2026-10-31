import { UserId } from 'src/shared/domain/user-id';
import { Keyword } from '../domain/keyword';
import { KeywordName } from '../domain/keyword-name';
import { KeywordRepository } from '../domain/keyword.repository';

/**
 * Double de test du port de persistance : un ensemble d'abonnés par mot-clé,
 * comme le champ `subscribers` du document Mongo.
 *
 * C'est le bénéfice concret d'avoir défini un port dans le domaine : les tests
 * des use cases tournent en millisecondes, sans base ni conteneur, et vérifient
 * la logique plutôt que le driver Mongo.
 */
export class InMemoryKeywordRepository extends KeywordRepository {
  private readonly store = new Map<string, Set<string>>();

  /** `initial` : mot-clé → adresses de ses abonnés (tableau vide = document sans abonné). */
  constructor(initial: Record<string, string[]> = {}) {
    super();
    for (const [name, subscribers] of Object.entries(initial)) {
      this.store.set(name, new Set(subscribers));
    }
  }

  findByName(owner: UserId, name: KeywordName): Promise<Keyword | null> {
    const subscribers = this.store.get(name.value);
    return Promise.resolve(
      subscribers === undefined
        ? null
        : Keyword.rehydrate(owner, name, subscribers.has(owner.value)),
    );
  }

  save(keyword: Keyword): Promise<void> {
    const subscribers = this.store.get(keyword.name.value) ?? new Set<string>();
    if (keyword.isTracked) subscribers.add(keyword.owner.value);
    else subscribers.delete(keyword.owner.value);
    this.store.set(keyword.name.value, subscribers);
    return Promise.resolve();
  }

  /** Helper d'assertion : abonnés persistés d'un mot-clé, triés ; `undefined` si inconnu. */
  subscribersOf(name: string): string[] | undefined {
    const subscribers = this.store.get(name);
    return subscribers === undefined ? undefined : [...subscribers].sort();
  }
}
