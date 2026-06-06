import { describe, it, expect } from 'vitest';
import { orderWords, matchesQuery, depthOf, depthTier, DEPTH_TIERS } from './GameButton.jsx';

// These are the pure, DOM-free grid helpers the container depends on at render
// (the .filter + sort) AND in the new-tile scroll guard. They run in the same
// node test environment as the reducer (no jsdom) since they're pure data-in/
// data-out — same rationale that drove extracting + testing migrateWords.

describe('orderWords', () => {
  it('sorts case-insensitively for "alpha" (primary-strength localeCompare)', () => {
    // Mixed-case input must order A-Z without case splitting the list into two
    // runs (e.g. "Apple" must sit before "banana", not after all lowercase).
    const out = orderWords(['banana', 'Apple', 'cherry', 'Date'], 'alpha');
    expect(out).toEqual(['Apple', 'banana', 'cherry', 'Date']);
  });

  it('does not mutate the input array when sorting alpha', () => {
    const input = ['water', 'earth', 'fire'];
    const out = orderWords(input, 'alpha');
    expect(input).toEqual(['water', 'earth', 'fire']); // untouched
    expect(out).toEqual(['earth', 'fire', 'water']); // fresh, sorted
    expect(out).not.toBe(input);
  });

  it('reverses insertion order for "newest" (most recent first)', () => {
    // Insertion order = discovery order; newest puts the last-discovered on top.
    const out = orderWords(['earth', 'fire', 'steam', 'mud'], 'newest');
    expect(out).toEqual(['mud', 'steam', 'fire', 'earth']);
  });

  it('does not mutate the input array when reversing newest', () => {
    const input = ['earth', 'fire', 'steam'];
    const out = orderWords(input, 'newest');
    expect(input).toEqual(['earth', 'fire', 'steam']); // untouched
    expect(out).toEqual(['steam', 'fire', 'earth']);
    expect(out).not.toBe(input);
  });

  it('keeps insertion order for "oldest" (oldest discovery first)', () => {
    // "oldest" is the inverse of "newest": raw insertion = discovery order, so
    // the oldest-discovered word stays on top.
    const out = orderWords(['earth', 'fire', 'steam', 'mud'], 'oldest');
    expect(out).toEqual(['earth', 'fire', 'steam', 'mud']);
    // And it is exactly the reverse of what "newest" produces from the same keys.
    expect(out).toEqual([...orderWords(['earth', 'fire', 'steam', 'mud'], 'newest')].reverse());
  });

  it('does not mutate the input array (and returns a copy) for oldest', () => {
    const input = ['earth', 'fire', 'steam'];
    const out = orderWords(input, 'oldest');
    expect(input).toEqual(['earth', 'fire', 'steam']); // untouched
    expect(out).toEqual(['earth', 'fire', 'steam']); // same order, fresh array
    expect(out).not.toBe(input);
  });

  it('returns the keys unchanged (identity) for any unknown sort mode', () => {
    const input = ['earth', 'fire', 'steam'];
    const out = orderWords(input, 'whatever');
    expect(out).toEqual(['earth', 'fire', 'steam']);
    // Identity fallback returns the same reference (not a copy).
    expect(out).toBe(input);
  });
});

describe('matchesQuery', () => {
  it('matches everything for an empty or whitespace-only query', () => {
    expect(matchesQuery('steam', '')).toBe(true);
    expect(matchesQuery('steam', '   ')).toBe(true);
    expect(matchesQuery('steam', undefined)).toBe(true);
    expect(matchesQuery('steam', null)).toBe(true);
  });

  it('matches a case-insensitive substring', () => {
    expect(matchesQuery('Acid Rain', 'rain')).toBe(true);
    expect(matchesQuery('Acid Rain', 'ACID')).toBe(true);
    expect(matchesQuery('steam', 'ea')).toBe(true);
  });

  it('trims the query before matching', () => {
    expect(matchesQuery('steam', '  ste  ')).toBe(true);
  });

  it('returns false when the substring is absent', () => {
    expect(matchesQuery('steam', 'xyz')).toBe(false);
    expect(matchesQuery('fire', 'water')).toBe(false);
  });
});

// depthOf / depthTier are the pure helpers behind the depth-tier tile treatment:
// how many combines deep a word is from the base set, derived from the stored
// lineage (words[w].from). Pure data-in/data-out, so they run in the node env
// without a DOM — same rationale as orderWords/matchesQuery above.
describe('depthOf', () => {
  // A small lineage map mirroring the reducer's { word: { emoji, from } } shape.
  const words = {
    earth: { emoji: '', from: null },
    water: { emoji: '', from: null },
    mud: { emoji: '', from: ['earth', 'water'] }, // depth 1
    plant: { emoji: '', from: ['mud', 'water'] }, // 1 + max(1, 0) = 2
    swamp: { emoji: '', from: ['plant', 'mud'] }, // 1 + max(2, 1) = 3
    forest: { emoji: '', from: ['swamp', 'plant'] }, // 1 + max(3, 2) = 4
  };

  it('returns 0 for a base word (from === null)', () => {
    expect(depthOf('earth', words, new Set())).toBe(0);
    expect(depthOf('water', words, new Set())).toBe(0);
  });

  it('returns 1 for a word crafted directly from two base words', () => {
    expect(depthOf('mud', words, new Set())).toBe(1);
  });

  it('returns 1 + max(parent depths) for a deeper chain', () => {
    expect(depthOf('plant', words, new Set())).toBe(2);
    expect(depthOf('swamp', words, new Set())).toBe(3);
    expect(depthOf('forest', words, new Set())).toBe(4);
  });

  it('does not infinite-loop on a cyclic `from` (cycle guard)', () => {
    // a <- b and b <- a: a hand-edited/corrupted save could produce this. The
    // looped branch must bottom out rather than recurse forever.
    const cyclic = {
      a: { emoji: '', from: ['b', 'earth'] },
      b: { emoji: '', from: ['a', 'earth'] },
      earth: { emoji: '', from: null },
    };
    // Just reaching an assertion proves it terminated; the value is finite.
    const d = depthOf('a', cyclic, new Set());
    expect(Number.isFinite(d)).toBe(true);
  });

  it('treats a missing parent as depth 0 without throwing (missing-parent guard)', () => {
    // `ghost` references a parent ("lost") that isn't in the map — e.g. a migrated
    // save that kept `from` but lost the parent word. The missing parent should
    // contribute 0, not throw: depth = 1 + max(0, depth(earth)=0) = 1.
    const partial = {
      earth: { emoji: '', from: null },
      ghost: { emoji: '', from: ['lost', 'earth'] },
    };
    expect(() => depthOf('ghost', partial, new Set())).not.toThrow();
    expect(depthOf('ghost', partial, new Set())).toBe(1);
  });

  it('treats an entry that is itself missing as depth 0', () => {
    expect(depthOf('nonexistent', words, new Set())).toBe(0);
  });
});

describe('depthTier', () => {
  it('caps the raw depth at DEPTH_TIERS - 1', () => {
    // Build a chain deeper than the cap and confirm it saturates at the top tier.
    const deep = {
      earth: { emoji: '', from: null },
      l1: { emoji: '', from: ['earth', 'earth'] }, // 1
      l2: { emoji: '', from: ['l1', 'earth'] }, // 2
      l3: { emoji: '', from: ['l2', 'earth'] }, // 3
      l4: { emoji: '', from: ['l3', 'earth'] }, // 4 (raw) -> capped
      l5: { emoji: '', from: ['l4', 'earth'] }, // 5 (raw) -> capped
    };
    expect(depthOf('l4', deep, new Set())).toBe(4);
    expect(depthOf('l5', deep, new Set())).toBe(5);
    // Both clamp to the top tier (DEPTH_TIERS - 1), not their raw depth.
    expect(depthTier('l4', deep)).toBe(DEPTH_TIERS - 1);
    expect(depthTier('l5', deep)).toBe(DEPTH_TIERS - 1);
  });

  it('passes through depths below the cap unchanged', () => {
    const words = {
      earth: { emoji: '', from: null },
      mud: { emoji: '', from: ['earth', 'earth'] },
    };
    expect(depthTier('earth', words)).toBe(0);
    expect(depthTier('mud', words)).toBe(1);
  });
});
