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

export class KeywordNotFound extends ResourceNotFoundError {
  readonly code = 'KEYWORD_NOT_FOUND';

  constructor(name: string) {
    super(`Le mot-clé « ${name} » n'existe pas.`);
  }
}
