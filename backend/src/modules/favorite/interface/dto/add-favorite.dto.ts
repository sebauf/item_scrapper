import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AddFavoriteDto {
  @ApiProperty({ description: 'Identifiant produit encodé, renvoyé par /products/{id} ou une liste' })
  @IsString()
  id!: string;
}
