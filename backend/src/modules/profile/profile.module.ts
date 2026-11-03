import { Module } from '@nestjs/common';
import { FuelModule } from '../fuel/fuel.module';
import { UpdateProfileCommand } from './application/commands/update-profile.command';
import { GetProfileQuery } from './application/queries/get-profile.query';
import { UserProfileRepository } from './domain/user-profile.repository';
import { MongoUserProfileRepository } from './infrastructure/mongo-user-profile.repository';
import { ProfileController } from './interface/profile.controller';

/**
 * Contexte Profile — coordonnées de l'utilisateur et préférences d'alerte.
 *
 * Écrit `user_profiles`, que le pipeline relit pour savoir à qui envoyer
 * l'alerte de réapprovisionnement, et pour quels carburants. Dépend du
 * contexte Fuel pour deux choses seulement : le vocabulaire des carburants et
 * le nombre de stations favorites (les stations surveillées).
 */
@Module({
  imports: [FuelModule],
  controllers: [ProfileController],
  providers: [
    GetProfileQuery,
    UpdateProfileCommand,
    { provide: UserProfileRepository, useClass: MongoUserProfileRepository },
  ],
})
export class ProfileModule {}
