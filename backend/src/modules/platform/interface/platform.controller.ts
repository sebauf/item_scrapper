import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppConfig } from 'src/config/app-config';
import { RedeployCommand } from '../application/commands/redeploy.command';
import { GetUpdateStatusQuery } from '../application/queries/get-update-status.query';
import { AdminTokenGuard } from './admin-token.guard';
import { RedeployResponse, UpdateStatusResponse } from './dto/update-status.response';

/**
 * Adaptateur HTTP du contexte platform : état des versions déployées et mise à
 * jour de l'application.
 *
 * Le statut est en lecture libre (il n'expose que des noms d'images et des
 * digests, déjà publics sur GHCR) ; la mise à jour exige le jeton admin.
 */
@ApiTags('platform')
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly getUpdateStatus: GetUpdateStatusQuery,
    private readonly redeployCommand: RedeployCommand,
    private readonly config: AppConfig,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Versions déployées comparées au registre d’images' })
  @ApiResponse({ status: 200, type: UpdateStatusResponse })
  async status(): Promise<UpdateStatusResponse> {
    const status = await this.getUpdateStatus.execute();
    return {
      clusterAvailable: status.clusterAvailable,
      redeployEnabled: status.clusterAvailable && this.config.adminToken !== null,
      updateAvailable: status.updateAvailable,
      rolloutInProgress: status.rolloutInProgress,
      components: status.components.map((component) => ({
        name: component.name,
        image: component.image,
        status: component.status,
        runningDigest: component.runningDigest,
        latestDigest: component.latestDigest,
      })),
      checkedAt: status.checkedAt.toISOString(),
    };
  }

  @Post('redeploy')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AdminTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Met l’application à jour (rollout restart des composants en retard)',
    description:
      '202 : les redémarrages sont lancés, pas terminés — suivre GET /platform/status. ' +
      'Les changements de manifests (variables, ressources, RBAC) ne sont pas couverts : ' +
      'ils demandent toujours k8s/install.sh.',
  })
  @ApiResponse({ status: 202, type: RedeployResponse })
  @ApiResponse({ status: 401, description: 'Jeton administrateur absent ou invalide' })
  @ApiResponse({ status: 403, description: 'ADMIN_TOKEN non configuré' })
  @ApiResponse({ status: 409, description: 'Hors cluster, déjà à jour, ou rollout en cours' })
  async redeploy(): Promise<RedeployResponse> {
    return { restarted: await this.redeployCommand.execute() };
  }
}
