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

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'TotalEnergies',
    description: 'Enseigne unifiée, d’après OpenStreetMap (ODbL) — null si inconnue',
  })
  brand!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'TotalEnergies Lyon Félix Faure',
    description: 'Nom de la station sur OpenStreetMap — null si inconnu',
  })
  name!: string | null;

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

  @ApiProperty({
    description: 'Station favorite — surveillée par l’alerte de réapprovisionnement',
  })
  isFavorite!: boolean;
}

export class BrandCountResponse {
  @ApiProperty({ example: 'TotalEnergies', description: 'Enseigne unifiée (OpenStreetMap, ODbL)' })
  brand!: string;

  @ApiProperty({ example: 12, description: 'Stations de l’enseigne dans la zone' })
  stationCount!: number;
}

export class FuelStationSearchResponse {
  @ApiProperty({ type: [FuelStationResponse] })
  stations!: FuelStationResponse[];

  @ApiProperty({ description: 'Vrai si d’autres stations dépassaient le plafond de la réponse' })
  truncated!: boolean;

  @ApiProperty({
    type: [BrandCountResponse],
    description:
      'Enseignes présentes dans le rayon (carburant appliqué, enseigne non), par ordre alphabétique',
  })
  brands!: BrandCountResponse[];

  @ApiProperty({ type: String, nullable: true, description: 'Dernier import du flux officiel' })
  lastImportAt!: string | null;

  @ApiProperty({ example: 72, description: 'Seuil au-delà duquel un prix est signalé ancien' })
  staleAfterHours!: number;
}

export class FavoriteStationResponse {
  @ApiProperty({ description: 'Identifiant officiel du point de vente', example: '69003001' })
  id!: string;

  @ApiProperty({ description: 'Date de mise en favori (ISO 8601)' })
  addedAt!: string;
}

export class ShortageOutlookResponse {
  @ApiProperty({
    example: 0.62,
    description: 'Probabilité (0 à 1) qu’une rupture commence avant `horizonEnd`',
  })
  risk!: number;

  @ApiProperty({
    enum: ['low', 'elevated', 'likely'],
    description: 'low < elevatedThreshold ≤ elevated < likelyThreshold ≤ likely',
  })
  level!: string;

  @ApiProperty({ description: 'Calcul de la prévision par le pipeline (ISO 8601)' })
  computedAt!: string;

  @ApiProperty({
    description:
      'Fin de l’horizon du modèle (computedAt + 24 h) : la rupture prévue commencerait avant cette date',
  })
  horizonEnd!: string;
}

export class FavoriteFuelResponse extends FuelPriceResponse {
  @ApiProperty({
    type: ShortageOutlookResponse,
    nullable: true,
    description:
      'Prévision de rupture à 24 h — null si le carburant est déjà en rupture, sans modèle en service, ou prévision trop ancienne',
  })
  shortageOutlook!: ShortageOutlookResponse | null;
}

export class FavoriteStationInfoResponse {
  @ApiProperty({ type: String, nullable: true, example: 'TotalEnergies' })
  brand!: string | null;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ example: '12 avenue Félix Faure' })
  address!: string;

  @ApiProperty({ example: 'Lyon' })
  city!: string;

  @ApiProperty({ example: '69003' })
  postcode!: string;

  @ApiProperty({ type: String, nullable: true, enum: ['R', 'A'] })
  roadType!: string | null;

  @ApiProperty({ example: 45.75938 })
  latitude!: number;

  @ApiProperty({ example: 4.85491 })
  longitude!: number;

  @ApiProperty({ type: [FavoriteFuelResponse] })
  fuels!: FavoriteFuelResponse[];
}

export class FavoriteStationDetailsResponse {
  @ApiProperty({ description: 'Identifiant officiel du point de vente', example: '69003001' })
  id!: string;

  @ApiProperty({ description: 'Date de mise en favori (ISO 8601)' })
  addedAt!: string;

  @ApiProperty({
    type: FavoriteStationInfoResponse,
    nullable: true,
    description: 'null si la station n’est plus dans le flux officiel',
  })
  station!: FavoriteStationInfoResponse | null;
}

export class ShortageForecastRulesResponse {
  @ApiProperty({ example: 24, description: 'Horizon du modèle, en heures' })
  horizonHours!: number;

  @ApiProperty({ example: 2, description: 'Âge au-delà duquel une prévision est écartée' })
  maxAgeHours!: number;

  @ApiProperty({ example: 0.15 })
  elevatedThreshold!: number;

  @ApiProperty({ example: 0.5, description: 'Même seuil par défaut que l’alerte de risque' })
  likelyThreshold!: number;

  @ApiProperty({ type: String, nullable: true, description: 'Prévision retenue la plus récente' })
  computedAt!: string | null;
}

export class FavoriteStationDetailsListResponse {
  @ApiProperty({
    type: [FavoriteStationDetailsResponse],
    description: 'De la plus récemment ajoutée à la plus ancienne',
  })
  stations!: FavoriteStationDetailsResponse[];

  @ApiProperty({ example: 72 })
  staleAfterHours!: number;

  @ApiProperty({ type: ShortageForecastRulesResponse })
  forecast!: ShortageForecastRulesResponse;
}
