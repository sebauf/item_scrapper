import { InvalidAlertFuels, InvalidPhoneNumber } from './profile.errors';
import { UserProfile } from './user-profile';

describe('UserProfile', () => {
  it('normalise le numéro et range les carburants dans l’ordre canonique, sans doublon', () => {
    const profile = UserProfile.create({ phone: '06 12 34 56 78', alertFuels: ['sp98', 'gazole', 'sp98'] });

    expect(profile.phone?.value).toBe('+33612345678');
    expect(profile.alertFuels).toEqual(['gazole', 'sp98']);
  });

  it.each([null, '', '   '])('un numéro %p efface le numéro', (phone) => {
    expect(UserProfile.create({ phone, alertFuels: [] }).phone).toBeNull();
  });

  it('refuse un numéro invalide', () => {
    expect(() => UserProfile.create({ phone: '1234', alertFuels: [] })).toThrow(InvalidPhoneNumber);
  });

  it.each([[['diesel']], [['gazole', 42]], ['gazole'], [undefined]])(
    'refuse des carburants %p',
    (alertFuels) => {
      expect(() => UserProfile.create({ phone: null, alertFuels })).toThrow(InvalidAlertFuels);
    },
  );

  describe('missingForFuelAlerts', () => {
    it('est vide quand numéro, carburant et station sont là', () => {
      const profile = UserProfile.create({ phone: '0612345678', alertFuels: ['gazole'] });

      expect(profile.missingForFuelAlerts(1)).toEqual([]);
    });

    it('liste tout ce qui manque, dans l’ordre de l’interface', () => {
      expect(UserProfile.empty().missingForFuelAlerts(0)).toEqual(['phone', 'fuels', 'stations']);
    });

    it('un numéro sans carburant ne suffit pas', () => {
      const profile = UserProfile.create({ phone: '0612345678', alertFuels: [] });

      expect(profile.missingForFuelAlerts(3)).toEqual(['fuels']);
    });
  });

  it('restore ignore un code inconnu et un numéro corrompu plutôt que de lever', () => {
    const profile = UserProfile.restore({ phone: 'n/a', alertFuels: ['e10', 'kerosene'] });

    expect(profile.phone).toBeNull();
    expect(profile.alertFuels).toEqual(['e10']);
  });
});
