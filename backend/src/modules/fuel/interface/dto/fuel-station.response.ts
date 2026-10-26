import { ApiProperty } from '@nestjs/swagger';
import { FUEL_TYPES } from '../../domain/fuel-type';

/**
 * Contrats de sortie du contexte Fuel — classes pour que @nestjs/swagger en
 * dérive le schéma OpenAPI, jamais instanciées (cf. catalog/interface/dto).
 */
export class FuelPriceResponse {
  @ApiProperty({ enum: FUEL_TYPES })
  code!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1.689,
    description: 'Prix au litre en euros, null pendant une rupture déclarée sans prix',
  })
  price!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Déclaration du prix par la station (ISO 8601) — pas la date de notre import',
  })
  updatedAt!: string | null;

  @ApiProperty({ description: 'Vendu, avec un prix, et sans rupture en cours' })
  available!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Début de la rupture en cours' })
  shortageSince!: string | null;

  @ApiProperty({ description: 'Prix déclaré il y a plus de `staleAfterHours` heures' })
  isStale!: boolean;
}

export class FuelStationResponse {
  @ApiProperty({ description: 'Identifiant officiel du point de vente', example: '69003001' })
  id!: string;

  @ApiProperty({ example: '12 avenue Félix Faure' })
  address!: string;

  @ApiProperty({ example: 'Lyon' })
  city!: string;

  @ApiProperty({ example: '69003' })
  postcode!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['R', 'A'],
    description: 'R = route, A = autoroute',
  })
  roadType!: string | null;

  @ApiProperty({ example: 45.75938 })
  latitude!: number;

  @ApiProperty({ example: 4.85491 })
  longitude!: number;

  @ApiProperty({ example: 1.234, description: 'Distance au centre de recherche, à vol d’oiseau' })
  distanceKm!: number;

  @ApiProperty({ type: [FuelPriceResponse], description: 'Carburants vendus par la station' })
  fuels!: FuelPriceResponse[];
}

export class FuelStationSearchResponse {
  @ApiProperty({ type: [FuelStationResponse] })
  stations!: FuelStationResponse[];

  @ApiProperty({ description: 'Vrai si d’autres stations dépassaient le plafond de la réponse' })
  truncated!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Dernier import du flux officiel' })
  lastImportAt!: string | null;

  @ApiProperty({ example: 72, description: 'Seuil au-delà duquel un prix est signalé ancien' })
  staleAfterHours!: number;
}
