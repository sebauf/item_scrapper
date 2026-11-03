import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserId } from 'src/shared/domain/user-id';
import { CurrentUser } from 'src/shared/interface/http/auth.guard';
import { UpdateProfileCommand } from '../application/commands/update-profile.command';
import { GetProfileQuery } from '../application/queries/get-profile.query';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileResponse } from './dto/profile.response';

/**
 * Profil de l'utilisateur connecté. Aucun identifiant dans le chemin : le
 * profil visé est toujours celui du jeton, il n'y a donc aucun moyen de lire
 * ou d'écrire celui d'un autre compte.
 */
@ApiBearerAuth()
@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly getProfile: GetProfileQuery,
    private readonly updateProfile: UpdateProfileCommand,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Profil de l’utilisateur et état de ses alertes carburant' })
  @ApiResponse({ status: 200, type: ProfileResponse })
  get(@CurrentUser() user: UserId): Promise<ProfileResponse> {
    return this.getProfile.execute(user);
  }

  @Put()
  @ApiOperation({ summary: 'Remplacer le numéro de téléphone et les carburants surveillés' })
  @ApiResponse({ status: 200, type: ProfileResponse, description: 'Profil enregistré, numéro normalisé' })
  @ApiResponse({ status: 400, description: 'Numéro de téléphone ou carburant invalide' })
  update(@CurrentUser() user: UserId, @Body() dto: UpdateProfileDto): Promise<ProfileResponse> {
    return this.updateProfile.execute(user, dto);
  }
}
