import { ApiProperty } from '@nestjs/swagger';
import { TrackedUrlSummary } from '../../application/ports/tracked-url-summary.read-model';

class TrackedUrlPriceResponse {
  @ApiProperty({ example: 12.99 })
  amount!: number;

  @ApiProperty({ example: 'EUR' })
  currency!: string;
}

/** Contrat de sortie HTTP — miroir de KeywordSummaryResponse. */
export class TrackedUrlSummaryResponse {
  @ApiProperty({ description: 'Identifiant encodé, à utiliser dans /product-urls/{id} et /products/{id}' })
  id!: string;

  @ApiProperty({ example: 'https://www.amazon.fr/dp/B0XXXXXXXX/' })
  url!: string;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: String, nullable: true })
  image!: string | null;

  @ApiProperty({ type: TrackedUrlPriceResponse, nullable: true })
  price!: TrackedUrlPriceResponse | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Dernier passage du scrapper, null si pas encore scrapée",
  })
  lastScrape!: string | null;

  static from(summary: TrackedUrlSummary): TrackedUrlSummaryResponse {
    return summary;
  }
}
