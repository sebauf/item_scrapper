import { ConflictError } from 'src/shared/domain/domain-error';

export class ClusterUnavailable extends ConflictError {
  readonly code = 'CLUSTER_UNAVAILABLE';

  constructor() {
    super(
      "Mise à jour impossible : le backend ne tourne pas dans Kubernetes (en développement local, redémarrez les services à la main).",
    );
  }
}

export class RolloutInProgress extends ConflictError {
  readonly code = 'ROLLOUT_IN_PROGRESS';

  constructor(names: readonly string[]) {
    super(`Une mise à jour est déjà en cours (${names.join(', ')}). Attendez qu'elle se termine.`);
  }
}

export class AlreadyUpToDate extends ConflictError {
  readonly code = 'ALREADY_UP_TO_DATE';

  constructor() {
    super("L'application est déjà à jour : aucune nouvelle image n'a été publiée.");
  }
}
