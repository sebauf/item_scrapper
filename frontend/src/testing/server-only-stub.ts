/**
 * `server-only` lève une erreur hors du runtime « react-server » de Next :
 * c'est son rôle en production. Vitest n'a pas ce runtime, d'où cet alias vide
 * (cf. vitest.config.ts) — les modules serveur restent testables.
 */
export {};
