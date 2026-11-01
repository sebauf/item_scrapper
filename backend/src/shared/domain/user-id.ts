/**
 * Objet-valeur : l'utilisateur au nom duquel une requête est faite.
 *
 * L'identifiant est l'**adresse e-mail Google vérifiée**, normalisée en
 * minuscules — pas le `sub` opaque de Google. Trois raisons, toutes pratiques :
 *
 *  - la liste blanche (`AUTH_ALLOWED_EMAILS` côté frontend), le propriétaire
 *    des données historiques (`AUTH_LEGACY_OWNER_EMAIL`) et l'utilisateur au
 *    nom duquel agit le serveur MCP (`MCP_USER_EMAIL`) se configurent par
 *    e-mail, sans avoir à aller lire un identifiant dans la base après une
 *    première connexion ;
 *  - les documents restent lisibles quand on inspecte Mongo à la main ;
 *  - une adresse gmail.com n'est jamais réattribuée.
 *
 * Contrepartie assumée : un compte Google Workspace supprimé dont l'adresse
 * serait réattribuée à une autre personne hériterait de ses mots-clés et
 * favoris. Pour une application personnelle ou familiale, c'est acceptable.
 *
 * Vit dans le noyau partagé (`shared/domain`) parce que tous les contextes qui
 * possèdent des données personnelles en ont besoin, et qu'il n'importe rien.
 */
export class UserId {
  static readonly MAX_LENGTH = 254; // RFC 5321

  private constructor(readonly value: string) {}

  /** Lève `InvalidUserId` si la valeur n'a pas la forme d'une adresse e-mail. */
  static create(raw: unknown): UserId {
    if (typeof raw !== 'string') throw new InvalidUserId('identifiant absent');
    const value = raw.trim().toLowerCase();
    if (value.length === 0 || value.length > UserId.MAX_LENGTH) {
      throw new InvalidUserId('identifiant vide ou trop long');
    }
    // Volontairement sommaire : l'adresse a été vérifiée par Google, on ne
    // fait que refuser ce qui ne peut manifestement pas en être une.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new InvalidUserId('identifiant mal formé');
    }
    return new UserId(value);
  }

  equals(other: UserId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * Pas une `DomainError` : un identifiant invalide ne vient jamais d'une saisie
 * de l'utilisateur, seulement d'un jeton mal construit. Il est traduit en 401
 * par la garde d'authentification, jamais en 400.
 */
export class InvalidUserId extends Error {
  constructor(reason: string) {
    super(`Utilisateur invalide : ${reason}.`);
    this.name = 'InvalidUserId';
  }
}
