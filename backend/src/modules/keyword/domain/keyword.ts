import { KeywordName } from './keyword-name';
import { KeywordAlreadyTracked } from './keyword.errors';

/**
 * Agrégat Keyword — le seul objet du système qui ait un cycle de vie et des
 * invariants à protéger. Tout changement d'état passe par une méthode qui
 * refuse les transitions illégales ; l'état interne n'est jamais modifiable
 * de l'extérieur.
 *
 * Cycle de vie :
 *
 *     (inexistant) --track()--> suivi <--retrack()-- non suivi
 *                                 |                      ^
 *                                 +------untrack()-------+
 *
 * En base, « non suivi » correspond à `enabled: false` : on ne supprime jamais
 * la ligne, car l'historique de prix scrapé sous ce mot-clé reste exploitable.
 */
export class Keyword {
  private constructor(
    readonly name: KeywordName,
    private _tracked: boolean,
  ) {}

  /** Nouveau mot-clé, immédiatement suivi. */
  static track(name: KeywordName): Keyword {
    return new Keyword(name, true);
  }

  /** Reconstruit un agrégat depuis la persistance — ne valide aucune règle. */
  static rehydrate(name: KeywordName, tracked: boolean): Keyword {
    return new Keyword(name, tracked);
  }

  get isTracked(): boolean {
    return this._tracked;
  }

  /**
   * Réactive un mot-clé précédemment retiré. Refuse si déjà suivi : demander
   * à suivre deux fois le même mot-clé est une erreur de l'appelant, pas un
   * non-événement (c'est le 409 que voit l'utilisateur du formulaire).
   */
  retrack(): void {
    if (this._tracked) throw new KeywordAlreadyTracked(this.name.value);
    this._tracked = true;
  }

  /**
   * Retire un mot-clé du suivi. Volontairement idempotent, à l'inverse de
   * `retrack` : retirer ce qui est déjà retiré aboutit à l'état demandé, et
   * c'est la sémantique attendue d'un DELETE HTTP.
   */
  untrack(): void {
    this._tracked = false;
  }
}
