import { InvalidInputError, ResourceNotFoundError } from 'src/shared/domain/domain-error';

export class InvalidStationSearch extends InvalidInputError {
  readonly code = 'INVALID_STATION_SEARCH';
}

export class InvalidStationId extends InvalidInputError {
  readonly code = 'INVALID_STATION_ID';
}

export class FuelStationNotFound extends ResourceNotFoundError {
  readonly code = 'FUEL_STATION_NOT_FOUND';
}
