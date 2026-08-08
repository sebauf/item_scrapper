import { DEAL_SCORE_THRESHOLD, isDeal } from './deal-policy';

describe('DealPolicy', () => {
  it('retient un score au seuil exact', () => {
    expect(isDeal(DEAL_SCORE_THRESHOLD)).toBe(true);
  });

  it('écarte un score juste sous le seuil', () => {
    expect(isDeal(DEAL_SCORE_THRESHOLD - 0.01)).toBe(false);
  });

  it.each([[null], [undefined]])('écarte un produit non scoré (%p)', (score) => {
    expect(isDeal(score)).toBe(false);
  });

  it('écarte un score négatif — prix au-dessus de sa moyenne', () => {
    expect(isDeal(-15)).toBe(false);
  });
});
