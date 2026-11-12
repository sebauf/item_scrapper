import { InvalidInputError, ResourceNotFoundError } from 'src/shared/domain/domain-error';

export class InvalidProductQuery extends InvalidInputError {
  readonly code = 'INVALID_PRODUCT_QUERY';
}

export class ProductNotFound extends ResourceNotFoundError {
  readonly code = 'PRODUCT_NOT_FOUND';

  constructor() {
    super("Ce produit n'existe pas ou n'a jamais été relevé.");
  }
}
