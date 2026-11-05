'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { saveProfileAction, type ProfileFormState } from '@/app/actions';
import type { FuelAlertRequirement, Profile } from '@/lib/api';
import { FUEL_CODES, FUEL_LABELS } from '@/lib/fuel';

/**
 * Libellés de ce qui manque pour recevoir les alertes. La règle (numéro +
 * carburant + station favorite) appartient au backend, qui envoie la liste
 * `fuelAlerts.missing` ; ici, on ne fait que la mettre en mots.
 */
const MISSING_LABELS: Record<FuelAlertRequirement, string> = {
  phone: 'renseignez votre numéro de téléphone',
  fuels: 'cochez au moins un carburant',
  stations: 'mettez au moins une station en favori (étoile ☆ sur la carte des carburants)',
};

/**
 * Formulaire de profil : numéro de téléphone et carburants surveillés par
 * l'alerte de réapprovisionnement. Les stations surveillées sont les
 * favorites, gérées depuis la carte : ce formulaire n'en montre que le
 * nombre.
 *
 * `profile` vient du serveur ; après un enregistrement réussi,
 * `revalidatePath('/profile')` le renvoie à jour (numéro normalisé, état de
 * l'alerte recalculé).
 */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveProfileAction, {});
  const { active, missing } = profile.fuelAlerts;
  const stations = profile.favoriteStationCount;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="État des alertes carburant"
        className={`rounded-2xl border px-4 py-3 text-sm ${
          active ? 'border-deal-border bg-deal-soft text-deal' : 'border-border bg-surface text-muted'
        }`}
      >
        {active ? (
          <p>
            <span className="font-semibold">Alertes actives.</span> Vous recevrez un message au{' '}
            {profile.phone} quand un carburant surveillé tombe en rupture, risque de l’être dans
            les 24 h, ou revient dans{' '}
            {stations > 1 ? `l’une de vos ${stations} stations favorites` : 'votre station favorite'}.
          </p>
        ) : (
          <>
            <p className="font-semibold text-foreground">Alertes inactives.</p>
            <p className="mt-1">
              Pour les recevoir : {missing.map((m) => MISSING_LABELS[m as FuelAlertRequirement]).join(' ; ')}.
            </p>
          </>
        )}
      </section>

      <form action={action} className="flex flex-col gap-6 bg-surface rounded-2xl border border-border-subtle p-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-sm font-semibold text-foreground">
            Numéro de téléphone
          </label>
          {/* text-base sous sm : en dessous de 16px, iOS zoome sur le champ au focus */}
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={32}
            defaultValue={profile.phone ?? ''}
            placeholder="06 12 34 56 78"
            aria-describedby="phone-help"
            className="w-full px-4 py-3 rounded-xl border border-border bg-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft text-base sm:text-sm"
          />
          <p id="phone-help" className="text-xs text-faint">
            Destinataire des alertes, transmis à l’agent qui envoie les messages. Laisser vide pour
            ne plus en recevoir.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-foreground mb-1">Carburants surveillés</legend>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FUEL_CODES.map((code) => (
              <label
                key={code}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border text-sm cursor-pointer hover:bg-surface-hover has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  type="checkbox"
                  name="alertFuels"
                  value={code}
                  defaultChecked={profile.alertFuels.includes(code)}
                  className="accent-[var(--color-accent)]"
                />
                {FUEL_LABELS[code]}
              </label>
            ))}
          </div>
        </fieldset>

        <p className="text-sm text-muted">
          Stations surveillées :{' '}
          <span className="font-semibold text-foreground">
            {stations === 0
              ? 'aucune station favorite'
              : stations === 1
                ? 'votre station favorite'
                : `vos ${stations} stations favorites`}
          </span>
          .{' '}
          <Link href="/fuel" className="text-accent hover:underline">
            Les gérer sur la carte
          </Link>
        </p>

        {state.error && (
          <p role="alert" className="text-sm text-danger bg-danger-soft px-3 py-2 rounded-lg">
            {state.error}
          </p>
        )}
        {state.success && !pending && (
          <p role="status" className="text-sm text-deal">
            Profil enregistré.
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="px-5 min-h-12 sm:min-h-0 sm:py-2.5 text-sm font-semibold bg-accent text-on-accent rounded-xl hover:bg-accent-hover disabled:opacity-60 transition-colors shadow-sm"
          >
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}
