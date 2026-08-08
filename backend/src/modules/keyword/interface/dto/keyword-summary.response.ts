import { ApiProperty } from '@nestjs/swagger';
import { KeywordSummary } from '../../application/ports/keyword-summary.read-model';

/**
 * Contrat de sortie HTTP. Classe (et non interface) pour que @nestjs/swagger
 * puisse en dériver le schéma OpenAPI, dont le frontend générera ses types.
 */
export class KeywordSummaryResponse {
  @ApiProperty({ example: 'lessive liquide' })
  keyword!: string;

  @ApiProperty({ example: 42, description: 'Produits distincts remontés pour ce mot-clé' })
  productCount!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-08-08T06:00:00.000Z',
    description: 'Dernier passage du scrapper, null si aucun produit',
  })
  lastScrape!: string | null;

  static from(summary: KeywordSummary): KeywordSummaryResponse {
    return summary;
  }
}
