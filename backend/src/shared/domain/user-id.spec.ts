import { InvalidUserId, UserId } from './user-id';

describe('UserId', () => {
  it('normalise casse et espaces : une même adresse Google = un même utilisateur', () => {
    expect(UserId.create('  Alice@Gmail.COM ').value).toBe('alice@gmail.com');
  });

  it('compare par valeur', () => {
    expect(UserId.create('a@b.fr').equals(UserId.create('A@B.FR'))).toBe(true);
  });

  it.each([[undefined], [42], [''], ['   '], ['pas-une-adresse'], ['a@b'], ['a b@c.fr']])(
    'refuse %p',
    (raw) => {
      expect(() => UserId.create(raw)).toThrow(InvalidUserId);
    },
  );

  it('refuse une adresse trop longue', () => {
    expect(() => UserId.create(`${'a'.repeat(250)}@b.fr`)).toThrow(InvalidUserId);
  });
});
