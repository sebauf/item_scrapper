import { FUEL_TYPES, FuelType, isFuelType } from '../../fuel/domain/fuel-type';
import { PhoneNumber } from './phone-number';
import { InvalidAlertFuels } from './profile.errors';

/**
 * Ce qui manque pour qu'un utilisateur reçoive les alertes de
 * réapprovisionnement — dans l'ordre où l'interface les présente.
 */
export const FUEL_ALERT_REQUIREMENTS = ['phone', 'fuels', 'stations'] as const;
export type FuelAlertRequirement = (typeof FUEL_ALERT_REQUIREMENTS)[number];

/**
 * Profil d'un utilisateur : ses coordonnées et ses préférences d'alerte.
 *
 * Un seul document par utilisateur, remplacé en entier à chaque
 * enregistrement (le formulaire de profil envoie tout). Pas d'invariant
 * entre les champs : un numéro sans carburant, ou l'inverse, est un état
 * légitime (« j'ai mis mes alertes en pause ») — c'est la règle d'activation,
 * `missingForFuelAlerts`, qui dit si l'alerte part.
 *
 * Le vocabulaire des carburants est celui du contexte Fuel (`FUEL_TYPES`),
 * importé plutôt que recopié : un code inconnu du flux officiel ne doit pas
 * pouvoir être enregistré, et le pipeline lit ces codes tels quels.
 */
export class UserProfile {
  private constructor(
    readonly phone: PhoneNumber | null,
    /** Sans doublon, dans l'ordre canonique de `FUEL_TYPES`. */
    readonly alertFuels: readonly FuelType[],
  ) {}

  static empty(): UserProfile {
    return new UserProfile(null, []);
  }

  /**
   * Depuis une saisie. `phone` vide ou null efface le numéro (et coupe donc
   * les alertes) ; `alertFuels` vide est accepté pour la même raison.
   */
  static create(input: { phone: unknown; alertFuels: unknown }): UserProfile {
    const phone =
      input.phone === null || (typeof input.phone === 'string' && input.phone.trim() === '')
        ? null
        : PhoneNumber.create(input.phone);

    if (!Array.isArray(input.alertFuels)) {
      throw new InvalidAlertFuels('Les carburants surveillés doivent être une liste.');
    }
    const unknown = input.alertFuels.filter(
      (code) => typeof code !== 'string' || !isFuelType(code),
    );
    if (unknown.length > 0) {
      throw new InvalidAlertFuels(
        `Carburant(s) inconnu(s) : ${unknown.map(String).join(', ')}. Attendu : ${FUEL_TYPES.join(', ')}.`,
      );
    }
    return new UserProfile(phone, UserProfile.canonical(input.alertFuels as FuelType[]));
  }

  /**
   * Depuis la base. Indulgent : un code devenu inconnu est ignoré plutôt que
   * de rendre le profil illisible, et un numéro corrompu est oublié — le
   * profil doit rester affichable pour que l'utilisateur le corrige.
   */
  static restore(doc: { phone?: unknown; alertFuels?: unknown }): UserProfile {
    let phone: PhoneNumber | null = null;
    try {
      phone = doc.phone == null ? null : PhoneNumber.create(doc.phone);
    } catch {
      phone = null;
    }
    const fuels = Array.isArray(doc.alertFuels)
      ? doc.alertFuels.filter((code): code is FuelType => typeof code === 'string' && isFuelType(code))
      : [];
    return new UserProfile(phone, UserProfile.canonical(fuels));
  }

  /**
   * Règle d'activation des alertes de réapprovisionnement : un numéro où les
   * envoyer, au moins un carburant et au moins une station favorite. Liste
   * vide ⇔ l'alerte est active. Même règle que le pipeline
   * (pipeline/src/fuel/alerts/subscribers.py, `load_subscribers`), qui l'applique
   * pour de bon.
   */
  missingForFuelAlerts(favoriteStationCount: number): FuelAlertRequirement[] {
    const missing: FuelAlertRequirement[] = [];
    if (this.phone === null) missing.push('phone');
    if (this.alertFuels.length === 0) missing.push('fuels');
    if (favoriteStationCount === 0) missing.push('stations');
    return missing;
  }

  private static canonical(fuels: readonly FuelType[]): FuelType[] {
    return FUEL_TYPES.filter((code) => fuels.includes(code));
  }
}
