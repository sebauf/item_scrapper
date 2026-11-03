import { InvalidPhoneNumber } from './profile.errors';

/**
 * Objet-valeur : numéro de téléphone au format international **E.164**
 * (`+33612345678`) — la forme qu'attendent les passerelles SMS, WhatsApp et
 * Signal, et donc celle que le webhook d'alerte transmet tel quel à l'agent.
 *
 * La saisie est indulgente, la valeur stockée ne l'est pas :
 *
 *  - espaces, points, tirets et parenthèses sont ignorés (`06 12 34 56 78`) ;
 *  - `00` en tête vaut `+` (préfixe international composé à la française) ;
 *  - un numéro national français à 10 chiffres (`0612345678`) devient
 *    `+33612345678` : l'application est française, c'est la saisie la plus
 *    probable ;
 *  - `+33 06…` (le 0 national gardé par erreur après l'indicatif) perd son 0.
 *
 * Au-delà, seule la forme E.164 est vérifiée (`+`, indicatif non nul, 8 à 15
 * chiffres au total) : savoir si un numéro est attribué, ou mobile, n'est pas
 * vérifiable sans un service tiers, et un fixe peut recevoir un SMS vocal.
 */
export class PhoneNumber {
  static readonly MAX_INPUT_LENGTH = 32;
  private static readonly E164 = /^\+[1-9]\d{7,14}$/;

  private constructor(readonly value: string) {}

  static create(raw: unknown): PhoneNumber {
    if (typeof raw !== 'string') {
      throw new InvalidPhoneNumber('Le numéro de téléphone doit être une chaîne de caractères.');
    }
    if (raw.length > PhoneNumber.MAX_INPUT_LENGTH) {
      throw new InvalidPhoneNumber('Numéro de téléphone trop long.');
    }

    let value = raw.replace(/[\s.\-()]/g, '');
    if (value.startsWith('00')) value = `+${value.slice(2)}`;
    if (/^0[1-9]\d{8}$/.test(value)) value = `+33${value.slice(1)}`;
    if (/^\+330[1-9]\d{8}$/.test(value)) value = `+33${value.slice(4)}`;

    if (!PhoneNumber.E164.test(value)) {
      throw new InvalidPhoneNumber(
        'Numéro de téléphone invalide : attendu un numéro français (06 12 34 56 78) ou international (+33 6 12 34 56 78).',
      );
    }
    return new PhoneNumber(value);
  }

  equals(other: PhoneNumber): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
