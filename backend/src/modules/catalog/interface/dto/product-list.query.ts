import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PRODUCT_SORT_OPTIONS, RawProductQuery } from '../../domain/product-query';

/**
 * Paramètres de requête de la liste de produits.
 *
 * Comme pour TrackKeywordDto, on ne déclare ici que la *forme* : tout arrive en
 * chaîne dans une query string, et c'est `ProductQuery.create` qui interprète et
 * valide. Les décorateurs `@ApiPropertyOptional` ne servent qu'à documenter.
 *
 * `@IsOptional` + `whitelist` font le reste : un paramètre inconnu vaut 400,
 * ce qui évite qu'une faute de frappe (`&sorted=`) passe pour un filtre ignoré.
 */
export class ProductListQueryDto implements RawProductQuery {
  @ApiPropertyOptional({ description: 'Recherche plein texte sur le titre', maxLength: 100 })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Bonnes affaires uniquement', enum: ['1', '0'] })
  @IsOptional()
  @IsString()
  deals?: string;

  @ApiPropertyOptional({ description: 'Prix minimum', example: '5' })
  @IsOptional()
  @IsString()
  min?: string;

  @ApiPropertyOptional({ description: 'Prix maximum', example: '50' })
  @IsOptional()
  @IsString()
  max?: string;

  @ApiPropertyOptional({ enum: PRODUCT_SORT_OPTIONS, default: 'deals' })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ description: 'Page, à partir de 1', default: '1' })
  @IsOptional()
  @IsString()
  page?: string;
}
