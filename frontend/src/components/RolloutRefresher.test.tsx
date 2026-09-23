import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationMock } from '@/testing/navigation-mock';
import { RolloutRefresher } from './RolloutRefresher';

describe('RolloutRefresher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigationMock.__reset();
  });
  afterEach(() => vi.useRealTimers());

  it('rafraîchit la page toutes les 5 secondes pendant un rollout', () => {
    render(<RolloutRefresher active={true} />);

    vi.advanceTimersByTime(10_000);

    expect(navigationMock.__router.refresh).toHaveBeenCalledTimes(2);
  });

  it('ne fait rien hors rollout', () => {
    render(<RolloutRefresher active={false} />);

    vi.advanceTimersByTime(10_000);

    expect(navigationMock.__router.refresh).not.toHaveBeenCalled();
  });

  it('s’arrête quand le rollout se termine', () => {
    const { rerender } = render(<RolloutRefresher active={true} />);
    vi.advanceTimersByTime(5_000);

    rerender(<RolloutRefresher active={false} />);
    vi.advanceTimersByTime(10_000);

    expect(navigationMock.__router.refresh).toHaveBeenCalledTimes(1);
  });
});
