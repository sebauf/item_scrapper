import {
  ConflictError,
  InvalidInputError,
  ResourceNotFoundError,
} from 'src/shared/domain/domain-error';

export class InvalidKeywordName extends InvalidInputError {
  readonly code = 'INVALID_KEYWORD_NAME';
}

export class KeywordAlreadyTracked extends ConflictError {
  readonly code = 'KEYWORD_ALREADY_TRACKED';

  constructor(name: string) {
    super(`Le mot-clé « ${name} » est déjà suivi.`);
  }
}

/**
 * 409 : la demande est valide, c'est l'état du compte (déjà au plafond) qui la
 * refuse. Le message est affiché tel quel par le formulaire.
 */
export class KeywordQuotaExceeded extends ConflictError {
  readonly code = 'KEYWORD_QUOTA_EXCEEDED';

  constructor(max: number) {
    super(`Vous suivez déjà ${max} mots-clés, le maximum autorisé. Retirez-en un pour en ajouter un autre.`);
  }
}

export class KeywordNotFound extends ResourceNotFoundError {
  readonly code = 'KEYWORD_NOT_FOUND';

  constructor(name: string) {
    super(`Le mot-clé « ${name} » n'existe pas.`);
  }
}
