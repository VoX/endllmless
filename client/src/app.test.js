import { describe, it, expect } from 'vitest';
import { isMilestone } from './App.jsx';

// isMilestone is the pure predicate behind the discovery-counter flourish:
// a member of the explicit MILESTONES set OR any multiple of 25, with an n>0
// guard so a reset's N->0 (and first paint) never celebrates. Pure, so it runs
// in the node env without a DOM — a regression guard so a future threshold tweak
// can't silently change which discoveries celebrate.
describe('isMilestone', () => {
  it('is true for the explicit milestone set members', () => {
    for (const n of [10, 25, 50, 100, 250, 500]) {
      expect(isMilestone(n)).toBe(true);
    }
  });

  it('is true for any positive multiple of 25 beyond the explicit set', () => {
    for (const n of [75, 125, 150, 1000]) {
      expect(isMilestone(n)).toBe(true);
    }
  });

  it('is false for 0 (reset / first paint never celebrates)', () => {
    expect(isMilestone(0)).toBe(false);
  });

  it('is false for non-milestone counts', () => {
    for (const n of [5, 24, 49, 51, 99]) {
      expect(isMilestone(n)).toBe(false);
    }
  });
});
