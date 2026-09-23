import { ComponentVersion } from './component-version';
import { AlreadyUpToDate, RolloutInProgress } from './platform.errors';

/**
 * Politique de mise à jour : qui redémarrer, et quand refuser.
 *
 * - Une nouvelle version est « disponible » dès qu'un composant est en retard
 *   sur son registre — c'est ce qui allume l'indicateur de l'interface.
 * - On ne relance rien pendant un rollout : empiler les redémarrages ne ferait
 *   que retarder celui en cours, pour le même résultat.
 * - On redémarre les composants en retard *et* ceux dont l'état est inconnu
 *   (registre injoignable). Redémarrer un composant déjà à jour est sans effet
 *   visible, alors qu'en ignorer un en retard laisserait l'application dans un
 *   état mixte. Et c'est sans risque : si la nouvelle image ne peut pas être
 *   tirée, l'ancien Pod reste en service (rolling update).
 * - Rien à redémarrer du tout : c'est un refus explicite plutôt qu'un succès
 *   silencieux, pour que l'utilisateur sache que son clic n'a rien changé.
 */
export const RedeployPolicy = {
  isUpdateAvailable(components: readonly ComponentVersion[]): boolean {
    return components.some((component) => component.status === 'outdated');
  },

  isRolloutInProgress(components: readonly ComponentVersion[]): boolean {
    return components.some((component) => component.status === 'updating');
  },

  /** Noms des composants à redémarrer. Lève si la mise à jour doit être refusée. */
  select(components: readonly ComponentVersion[]): string[] {
    const updating = components.filter((component) => component.status === 'updating');
    if (updating.length > 0) throw new RolloutInProgress(updating.map((c) => c.name));

    const targets = components.filter(
      (component) => component.status === 'outdated' || component.status === 'unknown',
    );
    if (targets.length === 0) throw new AlreadyUpToDate();

    return targets.map((component) => component.name);
  },
};
