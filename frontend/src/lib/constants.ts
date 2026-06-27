export const DEAL_SCORE_THRESHOLD = 10;

export function isGoodDeal(dealScore: number | undefined): boolean {
  return dealScore !== undefined && dealScore >= DEAL_SCORE_THRESHOLD;
}
