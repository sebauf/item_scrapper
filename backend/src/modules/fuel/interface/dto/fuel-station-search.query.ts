import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { FUEL_TYPES } from '../../domain/fuel-type';
import {
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  RawStationSearch,
  STATION_SORT_OPTIONS,
} from '../../domain/station-search';

/**
 * Paramètres de recherche de stations. Comme `ProductListQueryDto`, ne déclare
 * que la *forme* : c'est `StationSearch.create` qui valide et interprète.
 *
 * `lat` et `lng` sont `@IsOptional` ici alors qu'ils sont obligatoires : leur
 * absence est refusée par le domaine, avec un message métier plutôt que la
 * réponse générique de class-validator.
 */
export class FuelStationSearchQueryDto implements RawStationSearch {
  @ApiProperty({ description: 'Latitude du centre de recherche (WGS 84)', example: '45.7578' })
  @IsOptional()
  @IsString()
  lat?: string;

  @ApiProperty({ description: 'Longitude du centre de recherche (WGS 84)', example: '4.8320' })
  @IsOptional()
  @IsString()
  lng?: string;

  @ApiPropertyOptional({
    description: `Rayon de recherche en km, au plus ${MAX_RADIUS_KM}`,
    default: String(DEFAULT_RADIUS_KM),
  })
  @IsOptional()
  @IsString()
  radiusKm?: string;

  @ApiPropertyOptional({ enum: FUEL_TYPES, description: 'Ne garder que les stations qui le vendent' })
  @IsOptional()
  @IsString()
  fuel?: string;

  @ApiPropertyOptional({
    enum: STATION_SORT_OPTIONS,
    default: 'distance',
    description: '« price » exige « fuel »',
  })
  @IsOptional()
  @IsString()
  sort?: string;
}
