import { ApiProperty } from '@nestjs/swagger';
import { FUEL_TYPES } from '../../../fuel/domain/fuel-type';
import { FUEL_ALERT_REQUIREMENTS } from '../../domain/user-profile';

export class FuelAlertStatusResponse {
  @ApiProperty({ description: 'Vrai si l’alerte de réapprovisionnement part pour cet utilisateur' })
  active!: boolean;

  @ApiProperty({
    enum: FUEL_ALERT_REQUIREMENTS,
    isArray: true,
    description: 'Ce qui manque pour l’activer : numéro, carburant, station favorite. Vide si active',
  })
  missing!: string[];
}

export class ProfileResponse {
  @ApiProperty({ example: 'alice@example.com' })
  email!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '+33612345678',
    description: 'Numéro au format E.164, destinataire des alertes',
  })
  phone!: string | null;

  @ApiProperty({ enum: FUEL_TYPES, isArray: true, example: ['gazole'] })
  alertFuels!: string[];

  @ApiProperty({ description: 'Stations favorites — celles que surveille l’alerte' })
  favoriteStationCount!: number;

  @ApiProperty({ type: FuelAlertStatusResponse })
  fuelAlerts!: FuelAlertStatusResponse;
}
