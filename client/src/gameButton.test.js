import { describe, it, expect } from 'vitest';
import { orderWords, matchesQuery } from './GameButton.jsx';

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
