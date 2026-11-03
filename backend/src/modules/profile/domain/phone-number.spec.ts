import { PhoneNumber } from './phone-number';
import { InvalidPhoneNumber } from './profile.errors';

describe('PhoneNumber', () => {
  it.each([
    ['0612345678', '+33612345678'],
    ['06 12 34 56 78', '+33612345678'],
    ['06.12.34.56.78', '+33612345678'],
    ['06-12-34-56-78', '+33612345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+33 (0)6 12 34 56 78', '+33612345678'],
    ['0033612345678', '+33612345678'],
    ['+330612345678', '+33612345678'],
    ['0478123456', '+33478123456'],
    ['+32 470 12 34 56', '+32470123456'],
    ['+1 415 555 2671', '+14155552671'],
  ])('normalise %p en %p', (raw, expected) => {
    expect(PhoneNumber.create(raw).value).toBe(expected);
  });

  it.each([
    undefined,
    null,
    612345678,
    '',
    '06123456', // trop court
    '061234567890', // national trop long
    '0012', // international trop court
    '+0612345678', // indicatif nul
    '+3361234567890123', // plus de 15 chiffres
    '06 12 34 56 7a',
    '+33 6 12 34 56 78; DROP',
    '0'.repeat(40),
  ])('refuse %p', (raw) => {
    expect(() => PhoneNumber.create(raw)).toThrow(InvalidPhoneNumber);
  });
});
