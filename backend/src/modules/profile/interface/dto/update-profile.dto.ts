import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, ValidateIf } from 'class-validator';
import { FUEL_TYPES } from '../../../fuel/domain/fuel-type';

/**
 * Corps de `PUT /profile` — remplacement complet. La validation de forme
 * reste sommaire ici : les vraies règles (format du numéro, codes connus)
 * vivent dans le domaine, qui produit des messages en français.
 */
export class UpdateProfileDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '06 12 34 56 78',
    description: 'Numéro français ou international ; null ou vide pour l’effacer (coupe les alertes)',
  })
  @ValidateIf((dto: UpdateProfileDto) => dto.phone !== null)
  @IsString()
  phone!: string | null;

  @ApiProperty({
    enum: FUEL_TYPES,
    isArray: true,
    example: ['gazole'],
    description: 'Carburants dont le retour en station favorite déclenche une alerte',
  })
  @IsArray()
  @ArrayMaxSize(FUEL_TYPES.length * 2)
  @IsString({ each: true })
  alertFuels!: string[];
}
