import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BackendClient } from '../backend/client.js';
import { formatFavoriteStations, formatFuelStationSearch } from '../format-fuel.js';
import { runTool, text } from './tool-result.js';

/**
 * Outils du contexte Fuel : prix des carburants (flux officiel
 * data.economie.gouv.fr), stations favorites et prévisions à 24 h.
 *
 * Les bornes reprennent celles du backend (`fuel/domain/station-search.ts`) :
 * un argument hors bornes est refusé par le schéma, avant tout appel réseau.
 */

const FUEL_CODES = ['gazole', 'e10', 'sp98', 'sp95', 'e85', 'gplc'] as const;

/** Défaut et plafond du backend (`DEFAULT_RADIUS_KM`, `MAX_RADIUS_KM`). */
const DEFAULT_RADIUS_KM = 10;
const MAX_RADIUS_KM = 30;

/**
 * Le backend renvoie jusqu'à 200 stations — taillé pour une carte. Pour un
 * modèle, une dizaine suffit presque toujours : les résultats sont déjà triés,
 * les suivants coûtent des jetons sans changer la réponse.
 */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** Identifiant officiel du point de vente : des chiffres (le backend répond 400 sinon). */
const stationId = z
  .string()
  .regex(/^\d{1,12}$/, 'identifiant officiel attendu : des chiffres uniquement')
  .describe('Identifiant officiel de la station, renvoyé par find_fuel_stations');

export function registerFuelTools(server: McpServer, backend: BackendClient): void {
  server.registerTool(
    'find_fuel_stations',
    {
      title: 'Stations-service autour d’un point',
      description:
        'Stations-service autour de coordonnées GPS (WGS 84), avec leurs prix et ruptures ' +
        'en cours, triées par distance (défaut) ou par prix. Pas de géocodage : fournir ' +
        'latitude et longitude (ex. Lyon ≈ 45.76, 4.84). Le tri par prix exige un carburant. ' +
        'Le filtre enseigne attend le libellé exact renvoyé dans « Enseignes dans la zone ».',
      inputSchema: {
        latitude: z.number().min(-90).max(90).describe('Latitude du centre de recherche'),
        longitude: z.number().min(-180).max(180).describe('Longitude du centre de recherche'),
        radiusKm: z
          .number()
          .positive()
          .max(MAX_RADIUS_KM)
          .optional()
          .describe(`Rayon en km (défaut ${DEFAULT_RADIUS_KM}, au plus ${MAX_RADIUS_KM})`),
        fuel: z
          .enum(FUEL_CODES)
          .optional()
          .describe('Ne garder que les stations qui vendent ce carburant (e10 = SP95-E10)'),
        sort: z
          .enum(['distance', 'price'])
          .optional()
          .describe('Tri : distance (défaut) ou price (exige fuel)'),
        brand: z.string().min(1).max(60).optional().describe('Enseigne, libellé exact (ex. TotalEnergies)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Nombre de stations à afficher (défaut ${DEFAULT_LIMIT})`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ latitude, longitude, radiusKm, fuel, sort, brand, limit }) =>
      runTool(async () => {
        const result = await backend.searchFuelStations({
          latitude,
          longitude,
          radiusKm,
          fuel,
          sort,
          brand,
        });
        return text(
          formatFuelStationSearch(result, {
            radiusKm: radiusKm ?? DEFAULT_RADIUS_KM,
            fuel,
            limit: limit ?? DEFAULT_LIMIT,
          }),
        );
      }),
  );

  server.registerTool(
    'list_favorite_stations',
    {
      title: 'Mes stations',
      description:
        "Stations favorites de l'utilisateur avec leurs prix et, par carburant, la prévision " +
        'à 24 h : risque de rupture s’il est disponible, chance de retour à la pompe s’il est ' +
        'en rupture. Les coordonnées renvoyées peuvent servir de centre à find_fuel_stations.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => runTool(async () => text(formatFavoriteStations(await backend.listFavoriteStationDetails()))),
  );

  server.registerTool(
    'add_favorite_station',
    {
      title: 'Ajouter une station favorite',
      description:
        "Ajoute une station aux favorites de l'utilisateur. Ses alertes carburant (retour, " +
        'rupture, risque de rupture, par SMS ou messagerie si son profil est complet) ' +
        'surveilleront aussi cette station. Idempotent.',
      inputSchema: { id: stationId },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ id }) =>
      runTool(async () => {
        await backend.addFavoriteStation(id);
        return text(`Station ${id} ajoutée aux favorites.`);
      }),
  );

  server.registerTool(
    'remove_favorite_station',
    {
      title: 'Retirer une station favorite',
      description:
        'Retire une station des favorites : ses alertes carburant ne la surveillent plus. ' +
        'Idempotent (retirer une station absente ne fait rien).',
      inputSchema: { id: stationId },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ id }) =>
      runTool(async () => {
        await backend.removeFavoriteStation(id);
        return text(`Station ${id} retirée des favorites.`);
      }),
  );
}
