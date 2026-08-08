import { BackendError } from '../backend/client.js';

/** Forme minimale d'un résultat d'outil MCP : du texte, plus un drapeau d'erreur. */
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

export function failure(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }], isError: true };
}

/**
 * Une erreur d'appel doit revenir au modèle comme un résultat d'outil en échec,
 * pas comme une exception de protocole : l'agent peut alors corriger son appel
 * (mot-clé inconnu, filtre invalide) au lieu de voir la conversation s'arrêter.
 */
export async function runTool(action: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof BackendError) {
      const code = error.code === null ? '' : ` [${error.code}]`;
      return failure(`Erreur backend ${error.status}${code} : ${error.message}`);
    }
    return failure(`Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`);
  }
}
