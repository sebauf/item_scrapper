import { InvalidInputError, ResourceNotFoundError } from 'src/shared/domain/domain-error';

export class InvalidProductId extends InvalidInputError {
  readonly code = 'INVALID_PRODUCT_ID';

  constructor(reason: string) {
    super(`Identifiant produit invalide : ${reason}`);
  }
}

export class InvalidProductQuery extends InvalidInputError {
  readonly code = 'INVALID_PRODUCT_QUERY';
}

export class ProductNotFound extends ResourceNotFoundError {
  readonly code = 'PRODUCT_NOT_FOUND';

  constructor() {
    super("Ce produit n'existe pas ou n'a jamais été relevé.");
  }
}
