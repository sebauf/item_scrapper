import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Contrat d'entrée HTTP — miroir de TrackKeywordDto.
 *
 * Ne valide que la forme ; la validité de l'URL (http(s), domaine amazon.fr,
 * présence d'un ASIN) est une règle métier qui vit dans ProductUrl.
 */
export class TrackProductUrlDto {
  @ApiProperty({ example: 'https://www.amazon.fr/dp/B0XXXXXXXX/' })
  @IsString()
  url!: string;
}
