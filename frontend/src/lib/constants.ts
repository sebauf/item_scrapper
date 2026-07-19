export const DEAL_SCORE_THRESHOLD = 10;

/** Divisible by every grid column count (1/2/3/4) — no orphan rows */
export const PAGE_SIZE = 24;

export function isGoodDeal(dealScore: number | undefined): boolean {
  return dealScore !== undefined && dealScore >= DEAL_SCORE_THRESHOLD;
}
