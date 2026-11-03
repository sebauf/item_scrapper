import { InvalidInputError } from 'src/shared/domain/domain-error';

export class InvalidPhoneNumber extends InvalidInputError {
  readonly code = 'INVALID_PHONE_NUMBER';
}

export class InvalidAlertFuels extends InvalidInputError {
  readonly code = 'INVALID_ALERT_FUELS';
}
