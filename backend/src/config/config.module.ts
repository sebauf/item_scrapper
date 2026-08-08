import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config';

/**
 * Charge le .env puis expose une `AppConfig` typée et validée.
 *
 * On n'injecte volontairement pas le `ConfigService` de Nest dans le reste du
 * code : il renvoie des `string | undefined` et disperse la connaissance des
 * noms de variables. `AppConfig` centralise validation et typage en un endroit.
 */
@Global()
@Module({
  imports: [NestConfigModule.forRoot({ envFilePath: ['.env'] })],
  providers: [
    {
      provide: AppConfig,
      useFactory: (): AppConfig => AppConfig.fromEnv(process.env),
    },
  ],
  exports: [AppConfig],
})
export class ConfigModule {}
