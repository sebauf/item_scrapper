import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Contrat d'entrée HTTP.
 *
 * Il ne valide que la *forme* — « le champ existe et c'est une chaîne ». La
 * longueur maximale et le rejet du vide ne sont volontairement pas déclarés
 * ici : ce sont des règles métier, elles vivent dans KeywordName. Les
 * dupliquer en décorateurs créerait deux sources de vérité qui divergeraient
 * au premier changement.
 */
export class TrackKeywordDto {
  @ApiProperty({ example: 'lessive liquide', maxLength: 100 })
  @IsString()
  keyword!: string;
}
