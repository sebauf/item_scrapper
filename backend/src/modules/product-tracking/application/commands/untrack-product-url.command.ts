import { Injectable } from '@nestjs/common';
import { ProductUrl } from '../../domain/product-url';
import { ProductUrlNotFound } from '../../domain/product-tracking.errors';
import { TrackedUrlRepository } from '../../domain/tracked-url.repository';

/**
 * Retire une URL du suivi individuel — miroir de UntrackKeywordCommand.
 *
 * Prend directement l'URL canonique (pas un identifiant encodé) : c'est
 * l'interface, `catalog/domain/product-id.ts`, qui fait le décodage avant
 * d'appeler cette commande — cette dernière ne connaît pas la notion
 * d'identifiant HTTP, seulement l'URL métier.
 */
@Injectable()
export class UntrackProductUrlCommand {
  constructor(private readonly trackedUrls: TrackedUrlRepository) {}

  async execute(rawUrl: unknown): Promise<void> {
    const url = ProductUrl.create(rawUrl);
    const existing = await this.trackedUrls.findByUrl(url);

    if (existing === null) throw new ProductUrlNotFound(url.value);

    existing.untrack();
    await this.trackedUrls.save(existing);
  }
}
