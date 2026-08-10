import { ApiProperty } from '@nestjs/swagger';

export class FavoriteStatusResponse {
  @ApiProperty()
  isFavorite!: boolean;
}
