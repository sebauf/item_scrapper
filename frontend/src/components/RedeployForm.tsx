'use client';
import { useActionState } from 'react';
import { redeployAction, type RedeployState } from '@/app/actions';

/**
 * Formulaire de mise à jour. Le jeton sert aussi de confirmation : pas de
 * redémarrage de toute l'application sur un clic égaré.
 *
 * `type="password"` + `autoComplete` permettent au gestionnaire de mots de
 * passe du navigateur de le retenir ; l'application, elle, ne le stocke pas.
 */
export function RedeployForm({
  updateAvailable,
  rolloutInProgress,
}: {
  updateAvailable: boolean;
  rolloutInProgress: boolean;
}) {
  const [state, action, pending] = useActionState<RedeployState, FormData>(redeployAction, {});
  const disabled = pending || rolloutInProgress;

  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-1.5">Jeton administrateur</span>
        <input
          type="password"
          name="token"
          required
          autoComplete="current-password"
          placeholder="ADMIN_TOKEN"
          className="w-full px-4 py-3 rounded-xl border border-border bg-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft text-sm transition-shadow"
        />
      </label>

      <button
        type="submit"
        disabled={disabled}
        className="w-full sm:w-auto px-5 py-2.5 text-sm font-semibold bg-accent text-on-accent rounded-xl hover:bg-accent-hover disabled:opacity-60 transition-colors shadow-sm"
      >
        {pending
          ? 'Lancement…'
          : rolloutInProgress
            ? 'Mise à jour en cours…'
            : updateAvailable
              ? 'Mettre à jour l’application'
              : 'Redéployer quand même'}
      </button>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.restarted && (
        <p role="status" className="text-sm text-deal">
          Mise à jour lancée : {state.restarted.join(', ')}. La page se met à jour
          toute seule pendant le redémarrage.
        </p>
      )}
    </form>
  );
}
