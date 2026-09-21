import { InvalidProductId, ProductNotFound } from '../../domain/catalog.errors';
import { ProductId } from '../../domain/product-id';
import { aProductDetail, FakeProductReadModel } from '../../testing/fakes';
import { GetProductDetailQuery } from './get-product-detail.query';

/**
 * Deux refus distincts, et c'est le point du test : un identifiant illisible
 * est une erreur d'appel (400), un identifiant valide mais inconnu est une
 * ressource absente (404). Les confondre priverait le frontend du moyen de
 * distinguer une URL bricolée d'un produit réellement disparu.
 */
describe('GetProductDetailQuery', () => {
  const url = 'https://www.amazon.fr/dp/B0TEST0001';
  const encoded = ProductId.fromUrl(url).value;

  it('renvoie la fiche du produit demandé', async () => {
    const detail = aProductDetail({ url, title: 'Lessive liquide 3L' });
    const readModel = new FakeProductReadModel({ [url]: detail });

    await expect(new GetProductDetailQuery(readModel).execute(encoded)).resolves.toBe(detail);
  });

  it("décode l'identifiant avant d'interroger le read model", async () => {
    const readModel = new FakeProductReadModel({ [url]: aProductDetail({ url }) });

    await new GetProductDetailQuery(readModel).execute(encoded);

    expect(readModel.detailCalls[0].url).toBe(url);
  });

  it('refuse un identifiant mal formé sans toucher au read model', async () => {
    const readModel = new FakeProductReadModel();

    await expect(new GetProductDetailQuery(readModel).execute('pas/du/base64')).rejects.toThrow(
      InvalidProductId,
    );
    expect(readModel.detailCalls).toHaveLength(0);
  });

  it('signale un produit inconnu', async () => {
    const readModel = new FakeProductReadModel();

    await expect(new GetProductDetailQuery(readModel).execute(encoded)).rejects.toThrow(
      ProductNotFound,
    );
  });
});
