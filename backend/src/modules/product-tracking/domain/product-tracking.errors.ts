import {
  ConflictError,
  InvalidInputError,
  ResourceNotFoundError,
} from 'src/shared/domain/domain-error';

export class InvalidProductUrl extends InvalidInputError {
  readonly code = 'INVALID_PRODUCT_URL';
}

export class ProductUrlAlreadyTracked extends ConflictError {
  readonly code = 'PRODUCT_URL_ALREADY_TRACKED';

  constructor(url: string) {
    super(`L'URL « ${url} » est déjà suivie.`);
  }
}

/** 409, cf. KeywordQuotaExceeded. Concerne aussi l'ajout d'un favori. */
export class ProductUrlQuotaExceeded extends ConflictError {
  readonly code = 'PRODUCT_URL_QUOTA_EXCEEDED';

  constructor(max: number) {
    super(
      `Vous suivez déjà ${max} produits (favoris compris), le maximum autorisé. Retirez-en un pour en ajouter un autre.`,
    );
  }
}

export class ProductUrlNotFound extends ResourceNotFoundError {
  readonly code = 'PRODUCT_URL_NOT_FOUND';

  constructor(url: string) {
    super(`L'URL « ${url} » n'est pas suivie.`);
  }
}
