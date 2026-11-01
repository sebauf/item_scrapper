import { UserId } from 'src/shared/domain/user-id';
import { KeywordName } from './keyword-name';
import { KeywordAlreadyTracked } from './keyword.errors';

/**
 * Agrégat Keyword — un mot-clé **tel que le suit un utilisateur donné**.
 *
 * Le mot-clé lui-même (le terme scrapé) est partagé : deux utilisateurs qui
 * suivent « lessive » ne déclenchent qu'une recherche, et voient les mêmes
 * produits. Ce qui est personnel, c'est l'abonnement — d'où le `owner` porté par
 * l'agrégat : `track`/`untrack` ne concernent que lui, jamais les autres
 * abonnés.
 *
 * Cycle de vie (par utilisateur) :
 *
 *     (inexistant) --track()--> suivi <--retrack()-- non suivi
 *                                 |                      ^
 *                                 +------untrack()-------+
 *
 * « inexistant » = aucun utilisateur n'a jamais suivi ce terme (pas de document
 * dans `keywords`). « non suivi » = le document existe, mais `owner` n'est pas
 * parmi ses abonnés. Le document n'est jamais supprimé : l'historique de prix
 * scrapé sous ce mot-clé reste exploitable, et le scrapper s'arrête de lui-même
 * quand plus personne ne le suit (cf. MongoKeywordRepository.save).
 */
export class Keyword {
  private constructor(
    readonly owner: UserId,
    readonly name: KeywordName,
    private _tracked: boolean,
  ) {}

  /** Nouveau mot-clé, immédiatement suivi par `owner`. */
  static track(owner: UserId, name: KeywordName): Keyword {
    return new Keyword(owner, name, true);
  }

  /** Reconstruit un agrégat depuis la persistance — ne valide aucune règle. */
  static rehydrate(owner: UserId, name: KeywordName, tracked: boolean): Keyword {
    return new Keyword(owner, name, tracked);
  }

  get isTracked(): boolean {
    return this._tracked;
  }

  /**
   * (Re)suit un mot-clé. Refuse s'il est déjà suivi par `owner` : demander à
   * suivre deux fois le même mot-clé est une erreur de l'appelant, pas un
   * non-événement (c'est le 409 que voit l'utilisateur du formulaire). Qu'un
   * *autre* utilisateur le suive déjà n'a, en revanche, aucune importance.
   */
  retrack(): void {
    if (this._tracked) throw new KeywordAlreadyTracked(this.name.value);
    this._tracked = true;
  }

  /**
   * Retire un mot-clé du suivi de `owner`. Volontairement idempotent, à
   * l'inverse de `retrack` : retirer ce qui est déjà retiré aboutit à l'état
   * demandé, et c'est la sémantique attendue d'un DELETE HTTP.
   */
  untrack(): void {
    this._tracked = false;
  }
}
