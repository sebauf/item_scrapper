import { InvalidStationId } from './fuel.errors';
import { StationId } from './station-id';

describe('StationId', () => {
  it('accepte un identifiant officiel', () => {
    expect(StationId.create('69003001').value).toBe('69003001');
  });

  it.each([undefined, 69003001, '', 'abc', '69003001/../x', '1234567890123', ' 69003001'])(
    'refuse %p',
    (raw) => {
      expect(() => StationId.create(raw)).toThrow(InvalidStationId);
    },
  );
});
