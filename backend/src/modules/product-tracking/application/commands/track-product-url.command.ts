import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { ProductUrl } from '../../domain/product-url';
import { TrackedUrl } from '../../domain/tracked-url';
import { TrackedUrlRepository } from '../../domain/tracked-url.repository';

/**
 * Commande — miroir exact de TrackKeywordCommand : redemander le suivi d'une
 * URL déjà suivie est une erreur de l'appelant (409), pas un non-événement.
 *
 * Réutilisée par le module `favorite` (AddFavoriteCommand) pour garantir la
 * continuité du suivi de prix d'un produit mis en favori — celui-ci avale le
 * 409 « déjà suivie », qui n'a de sens que pour un appel direct du formulaire
 * d'ajout d'URL.
 */
@Injectable()
export class TrackProductUrlCommand {
  constructor(private readonly trackedUrls: TrackedUrlRepository) {}

  async execute(owner: UserId, rawUrl: unknown): Promise<void> {
    const url = ProductUrl.create(rawUrl);
    const existing = await this.trackedUrls.findByUrl(owner, url);

    if (existing === null) {
      await this.trackedUrls.save(TrackedUrl.track(owner, url));
      return;
    }

    existing.retrack(); // lève ProductUrlAlreadyTracked si `owner` la suit déjà
    await this.trackedUrls.save(existing);
  }
}
