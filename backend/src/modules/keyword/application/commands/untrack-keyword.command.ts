import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { KeywordName } from '../../domain/keyword-name';
import { KeywordNotFound } from '../../domain/keyword.errors';
import { KeywordRepository } from '../../domain/keyword.repository';

/**
 * Retire un mot-clé du suivi de `owner`.
 *
 * Un mot-clé que personne n'a jamais suivi lève KeywordNotFound (→ 404), pour
 * qu'un appel erroné soit visible au lieu de passer pour un succès. Retirer un
 * mot-clé que `owner` ne suit pas (ou plus) reste un succès (cf.
 * Keyword.untrack) — y compris quand d'autres le suivent : leur abonnement
 * n'est pas touché.
 *
 * Avant l'authentification, un mot-clé pouvait être affiché depuis ses seuls
 * relevés `items_raw`, sans document dans `keywords` (scrapé avant que la
 * collection n'existe). Ce cas n'existe plus : la page d'un utilisateur ne liste
 * que ses abonnements, qui ont tous un document.
 */
@Injectable()
export class UntrackKeywordCommand {
  constructor(private readonly keywords: KeywordRepository) {}

  async execute(owner: UserId, rawName: unknown): Promise<void> {
    const name = KeywordName.create(rawName);
    const existing = await this.keywords.findByName(owner, name);

    if (existing === null) throw new KeywordNotFound(name.value);

    existing.untrack();
    await this.keywords.save(existing);
  }
}
