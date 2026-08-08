import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Db } from 'mongodb';
import { MONGO_DB } from 'src/shared/infrastructure/mongo/mongo.tokens';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  /**
   * Sonde de vivacité : ne teste *que* le processus. Ne doit toucher aucune
   * dépendance externe, sinon une coupure Mongo ferait redémarrer le pod en
   * boucle sans rien réparer.
   */
  @Get('live')
  @ApiOperation({ summary: 'Le processus répond' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Sonde de disponibilité : le service peut-il servir du trafic ? Ici, ça
   * suppose une base joignable. Un échec retire le pod du service sans le tuer.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Le service peut traiter des requêtes (MongoDB joignable)' })
  async ready(): Promise<{ status: 'ok'; mongodb: 'up' }> {
    try {
      await this.db.command({ ping: 1 });
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        mongodb: 'down',
        message: error instanceof Error ? error.message : 'MongoDB injoignable',
      });
    }
    return { status: 'ok', mongodb: 'up' };
  }
}
