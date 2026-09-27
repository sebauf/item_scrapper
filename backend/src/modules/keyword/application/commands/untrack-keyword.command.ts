import { Injectable } from '@nestjs/common';
import { Keyword } from '../../domain/keyword';
import { KeywordName } from '../../domain/keyword-name';
import { KeywordNotFound } from '../../domain/keyword.errors';
import { KeywordRepository } from '../../domain/keyword.repository';
import { ScrapedKeywords } from '../ports/scraped-keywords';

/**
 * Retire un mot-clé du suivi.
 *
 * Remplace frontend/src/app/actions.ts:deleteKeyword, avec une différence
 * assumée : l'ancienne version ignorait silencieusement un mot-clé inexistant.
 * Ici on lève KeywordNotFound (→ 404), pour qu'un appel erroné du frontend soit
 * visible au lieu de passer pour un succès. Retirer un mot-clé *déjà* retiré
 * reste, lui, un succès (cf. Keyword.untrack).
 *
 * Deux façons d'être suivi, donc deux façons d'être retiré — c'est ce que la
 * page des mots-clés affiche qui fait loi (`trackedKeywordNames`) :
 *
 *  - un document existe → on le passe à `enabled: false` ;
 *  - aucun document mais des relevés dans `items_raw` (mot-clé scrapé avant que
 *    la collection `keywords` n'existe) → la page le liste quand même, et il n'y
 *    avait jusqu'ici *rien à modifier* : le 404 remontait, le frontend le
 *    traitait comme un succès, et la ligne réapparaissait au rechargement. On
 *    écrit donc la pierre tombale qui manquait.
 *
 * Le 404 ne reste que pour un mot-clé que rien ne connaît — un nom appelé par
 * erreur, ce qu'il doit continuer de signaler.
 */
@Injectable()
export class UntrackKeywordCommand {
  constructor(
    private readonly keywords: KeywordRepository,
    private readonly scraped: ScrapedKeywords,
  ) {}

  async execute(rawName: unknown): Promise<void> {
    const name = KeywordName.create(rawName);
    const existing = await this.keywords.findByName(name);

    if (existing !== null) {
      existing.untrack();
      await this.keywords.save(existing);
      return;
    }

    if (!(await this.scraped.has(name))) throw new KeywordNotFound(name.value);

    await this.keywords.save(Keyword.untracked(name));
  }
}
