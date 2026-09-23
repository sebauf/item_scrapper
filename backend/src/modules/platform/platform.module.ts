import { Module } from '@nestjs/common';
import { RedeployCommand } from './application/commands/redeploy.command';
import { ClusterGateway } from './application/ports/cluster.gateway';
import { ImageRegistry } from './application/ports/image-registry';
import { GetUpdateStatusQuery } from './application/queries/get-update-status.query';
import { KubernetesClusterGateway } from './infrastructure/kubernetes-cluster.gateway';
import { OciImageRegistry } from './infrastructure/oci-image.registry';
import { AdminTokenGuard } from './interface/admin-token.guard';
import { PlatformController } from './interface/platform.controller';

/**
 * Câblage du contexte platform — le seul qui ne touche pas MongoDB : ses
 * sources sont l'API Kubernetes et le registre d'images.
 */
@Module({
  controllers: [PlatformController],
  providers: [
    GetUpdateStatusQuery,
    RedeployCommand,
    AdminTokenGuard,
    { provide: ClusterGateway, useClass: KubernetesClusterGateway },
    { provide: ImageRegistry, useClass: OciImageRegistry },
  ],
})
export class PlatformModule {}
