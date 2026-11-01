import { subscriptionUpdate } from './subscriptions';

/**
 * Le pipeline est évalué par Mongo, pas ici : ces tests figent sa forme, et
 * surtout l'ordre des deux étapes — `enabled` doit être calculé sur la liste
 * d'abonnés **après** modification.
 */
describe('subscriptionUpdate', () => {
  it('ajoute l’abonné sans doublon, puis dérive enabled', () => {
    expect(subscriptionUpdate('a@b.fr', true)).toEqual([
      { $set: { subscribers: { $setUnion: [{ $ifNull: ['$subscribers', []] }, ['a@b.fr']] } } },
      { $set: { enabled: { $gt: [{ $size: '$subscribers' }, 0] } } },
    ]);
  });

  it('retire l’abonné, puis dérive enabled', () => {
    expect(subscriptionUpdate('a@b.fr', false)).toEqual([
      { $set: { subscribers: { $setDifference: [{ $ifNull: ['$subscribers', []] }, ['a@b.fr']] } } },
      { $set: { enabled: { $gt: [{ $size: '$subscribers' }, 0] } } },
    ]);
  });
});
