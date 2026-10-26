import { InvalidInputError } from 'src/shared/domain/domain-error';

export class InvalidStationSearch extends InvalidInputError {
  readonly code = 'INVALID_STATION_SEARCH';
}
