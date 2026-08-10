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

export class ProductUrlNotFound extends ResourceNotFoundError {
  readonly code = 'PRODUCT_URL_NOT_FOUND';

  constructor(url: string) {
    super(`L'URL « ${url} » n'est pas suivie.`);
  }
}
