import { ApiProperty } from '@nestjs/swagger';
import { COMPONENT_STATUSES, ComponentStatus } from '../../domain/component-version';

export class ComponentVersionResponse {
  @ApiProperty({ example: 'price-tracker-backend' })
  name!: string;

  @ApiProperty({ example: 'ghcr.io/owner/item_scrapper-backend:main' })
  image!: string;

  @ApiProperty({
    enum: COMPONENT_STATUSES,
    enumName: 'ComponentStatus',
    description:
      'up-to-date : même digest que le registre ; outdated : nouvelle image publiée ; ' +
      'unknown : comparaison impossible (registre injoignable) ; updating : rollout en cours',
  })
  status!: ComponentStatus;

  @ApiProperty({ type: String, nullable: true, example: 'sha256:…' })
  runningDigest!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'sha256:…' })
  latestDigest!: string | null;
}

export class UpdateStatusResponse {
  @ApiProperty({ description: 'Faux hors Kubernetes (développement local) : rien à inspecter.' })
  clusterAvailable!: boolean;

  @ApiProperty({ description: 'Vrai si le bouton de mise à jour peut être proposé (cluster + ADMIN_TOKEN).' })
  redeployEnabled!: boolean;

  @ApiProperty({ description: 'Au moins un composant tourne une image plus ancienne que le registre.' })
  updateAvailable!: boolean;

  @ApiProperty()
  rolloutInProgress!: boolean;

  @ApiProperty({ type: [ComponentVersionResponse] })
  components!: ComponentVersionResponse[];

  @ApiProperty({ type: String, format: 'date-time' })
  checkedAt!: string;
}

export class RedeployResponse {
  @ApiProperty({ type: [String], example: ['price-tracker-frontend', 'price-tracker-backend'] })
  restarted!: string[];
}
