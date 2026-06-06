import { describe, it, expect } from 'vitest';
import { gameReducer, initialGameState, baseWords, migrateWords } from './gameReducer.js';

// Helper: a state that already has a first+second selected and is mid-flight, so
// new_word / loading_error transitions have a concrete pair to act on.
const pairState = (overrides = {}) => ({
  ...initialGameState,
  wordState: {
    ...initialGameState.wordState,
    first: 'fire',
    second: 'water',
    loading: true,
    ...overrides,
  },
});

describe('baseWords', () => {
  it('is the frozen, sorted-by-source snapshot of the default word keys', () => {
    // The five primordial elements the tile grid marks as "foundational".
    expect(baseWords).toEqual(['earth', 'fire', 'life', 'water', 'wind']);
  });

  it('is frozen so consumers cannot mutate the source set', () => {
    expect(Object.isFrozen(baseWords)).toBe(true);
    // A mutation attempt must not change the snapshot (silently ignored in
    // sloppy mode; the frozen check above is the real guarantee).
    expect(() => {
      try { baseWords.push('steam'); } catch { /* strict-mode throw is fine */ }
    }).not.toThrow();
    expect(baseWords).toEqual(['earth', 'fire', 'life', 'water', 'wind']);
  });

  it('matches the default discovered set the game starts/resets to', () => {
    // baseWords (grid's "foundational" marker) and initialGameState.words (the
    // reducer's default set) must stay in lockstep, or a reset would leave tiles
    // that no longer read as foundational.
    expect([...baseWords].sort()).toEqual(Object.keys(initialGameState.words).sort());
  });
});

describe('gameReducer: new_word / isFirstFound', () => {
  it('marks a never-seen word as a first find and adds it to words', () => {
    const state = pairState();
    const next = gameReducer(state, { type: 'new_word', word: 'steam', emoji: '' });

    expect(next.wordState.new).toBe('steam');
    expect(next.wordState.isFirstFound).toBe(true);
    expect(next.wordState.loading).toBe(false);
    expect(next.wordState.foundDelay).toBe(true);
    // The new word is merged into the discovered set as { emoji, from }.
    expect(next.words.steam.emoji).toBe('');
    // The selected pair is preserved on the result transition.
    expect(next.wordState.first).toBe('fire');
    expect(next.wordState.second).toBe('water');
  });

  it('marks an already-discovered word as not a first find', () => {
    // "water" is one of the default starting words, so combining into it again
    // is a rediscovery, not a new find.
    const state = pairState();
    const next = gameReducer(state, { type: 'new_word', word: 'water', emoji: '' });

    expect(next.wordState.new).toBe('water');
    expect(next.wordState.isFirstFound).toBe(false);
    // Rediscovery preserves the existing entry untouched (first path wins), so
    // the base word keeps its shipped emoji rather than being clobbered by the
    // action's emoji.
    expect(next.words.water.emoji).toBe('💦');
  });

  it('clears any stale error so a success never renders next to a failure message', () => {
    const state = pairState({ error: 'generic' });
    const next = gameReducer(state, { type: 'new_word', word: 'steam', emoji: '' });
    expect(next.wordState.error).toBe('');
    expect(next.wordState.new).toBe('steam');
  });

  it('treats a prototype-named word ("constructor") as a real first find, not a rediscovery', () => {
    // `words` is a plain object, so `words["constructor"]` reads the inherited
    // Object.prototype.constructor FUNCTION rather than undefined. A direct
    // `=== undefined` check would mis-flag this as already discovered AND store
    // the function as the entry, blanking/crashing every downstream `.emoji`
    // read. The model can emit "constructor" (a common English word), so this
    // must be handled with own-property semantics.
    const state = pairState();
    const next = gameReducer(state, { type: 'new_word', word: 'constructor', emoji: '🏗️' });

    expect(next.wordState.isFirstFound).toBe(true);
    // The entry is the real { emoji, from } object, NOT the inherited function.
    expect(next.words.constructor).toEqual({ emoji: '🏗️', from: ['fire', 'water'] });
    expect(typeof next.words.constructor).toBe('object');
  });
});

describe('gameReducer: new_word / recipe lineage (`from`)', () => {
  it('records the source pair on a first find', () => {
    const state = pairState(); // first: 'fire', second: 'water'
    const next = gameReducer(state, { type: 'new_word', word: 'steam', emoji: '♨️' });

    expect(next.words.steam).toEqual({ emoji: '♨️', from: ['fire', 'water'] });
  });

  it('does NOT change a word\'s stored `from` on rediscovery (first path wins)', () => {
    // Pre-seed "steam" as discovered from a specific pair, then rediscover it via
    // a DIFFERENT pair. The original lineage and emoji must survive untouched.
    const seeded = {
      ...initialGameState,
      words: { ...initialGameState.words, steam: { emoji: '♨️', from: ['fire', 'water'] } },
      wordState: { ...initialGameState.wordState, first: 'earth', second: 'wind', loading: true },
    };
    const next = gameReducer(seeded, { type: 'new_word', word: 'steam', emoji: '🆕' });

    expect(next.wordState.isFirstFound).toBe(false);
    // `from` is preserved AND the emoji is not clobbered by the rediscovery.
    expect(next.words.steam).toEqual({ emoji: '♨️', from: ['fire', 'water'] });
  });

  it('keeps base words at from:null and never overwrites their lineage', () => {
    // "water" ships as a base word with from:null. Rediscovering it must not
    // invent a source pair for it.
    const state = pairState(); // first: 'fire', second: 'water'
    expect(initialGameState.words.water.from).toBe(null);
    const next = gameReducer(state, { type: 'new_word', word: 'water', emoji: '💦' });
    expect(next.words.water.from).toBe(null);
  });
});

describe('migrateWords', () => {
  it('coerces a legacy string-emoji map to the { emoji, from:null } shape without throwing', () => {
    // The OLD persisted shape: { word: "🔥" }.
    const legacy = { fire: '🔥', steam: '♨️' };
    const migrated = migrateWords(legacy);
    expect(migrated).toEqual({
      fire: { emoji: '🔥', from: null },
      steam: { emoji: '♨️', from: null },
    });
  });

  it('passes through the current { emoji, from } shape, preserving a valid source pair', () => {
    const current = {
      water: { emoji: '💦', from: null },
      steam: { emoji: '♨️', from: ['fire', 'water'] },
    };
    expect(migrateWords(current)).toEqual(current);
  });

  it('drops a garbled entry to a safe { emoji:"", from:null } instead of crashing a read', () => {
    const mixed = { good: '🔥', bad: 123, partial: { foo: 'bar' }, halfpair: { emoji: '🌫️', from: ['only'] } };
    expect(migrateWords(mixed)).toEqual({
      good: { emoji: '🔥', from: null },
      bad: { emoji: '', from: null },
      partial: { emoji: '', from: null },
      halfpair: { emoji: '🌫️', from: null }, // malformed from -> treated as base
    });
  });

  it('rejects a 2-element `from` whose elements are not both strings (-> base)', () => {
    // A persisted/garbled pair like [null, 5] is the right length but not a real
    // lineage; it must collapse to null so a future surface never renders a
    // "null + 5" caption from it.
    const garbledPair = { steam: { emoji: '♨️', from: [null, 5] } };
    expect(migrateWords(garbledPair)).toEqual({
      steam: { emoji: '♨️', from: null },
    });
  });

  it('returns null for non-object / array / falsy blobs so the caller falls back to defaults', () => {
    expect(migrateWords(null)).toBe(null);
    expect(migrateWords(undefined)).toBe(null);
    expect(migrateWords('nope')).toBe(null);
    expect(migrateWords([1, 2, 3])).toBe(null);
  });
});

describe('gameReducer: click_word', () => {
  it('selects the first word when nothing is selected yet', () => {
    const next = gameReducer(initialGameState, { type: 'click_word', word: 'fire' });

    expect(next.wordState.first).toBe('fire');
    expect(next.wordState.second).toBe('');
    expect(next.confirmReset).toBe(false);
  });

  it('selects the second word when a first is already chosen', () => {
    const afterFirst = gameReducer(initialGameState, { type: 'click_word', word: 'fire' });
    const afterSecond = gameReducer(afterFirst, { type: 'click_word', word: 'water' });

    expect(afterSecond.wordState.first).toBe('fire');
    expect(afterSecond.wordState.second).toBe('water');
  });

  it('starts a fresh selection (clearing the previous result) after a combine resolved', () => {
    // wordState.new is set => the next click begins a brand-new pair.
    const resolved = {
      ...initialGameState,
      wordState: {
        ...initialGameState.wordState,
        first: 'fire',
        second: 'water',
        new: 'steam',
      },
    };
    const next = gameReducer(resolved, { type: 'click_word', word: 'earth' });

    expect(next.wordState.first).toBe('earth');
    expect(next.wordState.second).toBe('');
    expect(next.wordState.new).toBe('');
  });

  it('queues clicks while loading instead of mutating the in-flight pair', () => {
    const loading = pairState();
    const afterQueue = gameReducer(loading, { type: 'click_word', word: 'earth' });
    // The in-flight pair is untouched; the click becomes a queued first word.
    expect(afterQueue.wordState.first).toBe('fire');
    expect(afterQueue.wordState.second).toBe('water');
    expect(afterQueue.wordsQueue).toEqual([{ first: 'earth', second: '' }]);

    // A second queued click fills the pending queue entry's second slot.
    const afterQueue2 = gameReducer(afterQueue, { type: 'click_word', word: 'wind' });
    expect(afterQueue2.wordsQueue).toEqual([{ first: 'earth', second: 'wind' }]);
  });
});

describe('gameReducer: reseed_word', () => {
  it('seeds a fresh single-word selection even during the result hold (foundDelay)', () => {
    // The lineage chips only render during the result hold, where foundDelay is
    // truthy. A plain click_word there would ENQUEUE; reseed_word must instead
    // start a brand-new selection with just `first` set, dropping the held result.
    const held = {
      ...initialGameState,
      wordState: {
        ...initialGameState.wordState,
        first: 'fire',
        second: 'water',
        new: 'steam',
        isFirstFound: true,
        foundDelay: true,
      },
    };
    const next = gameReducer(held, { type: 'reseed_word', word: 'fire' });

    expect(next.wordState.first).toBe('fire');
    expect(next.wordState.second).toBe('');
    expect(next.wordState.new).toBe('');
    expect(next.wordState.foundDelay).toBe(false);
    expect(next.wordState.loading).toBe(false);
    expect(next.confirmReset).toBe(false);
  });

  it('also seeds fresh while a request is in flight (loading), not enqueue', () => {
    const loading = pairState(); // first/second set, loading: true
    const next = gameReducer(loading, { type: 'reseed_word', word: 'earth' });
    expect(next.wordState).toEqual({
      ...initialGameState.wordState,
      first: 'earth',
    });
    expect(next.wordsQueue).toEqual([]);
  });

  it('drops any queued batch so a pending found_delay cannot pop a stray pair', () => {
    const queued = {
      ...pairState(),
      wordsQueue: [{ first: 'earth', second: 'wind' }],
    };
    const next = gameReducer(queued, { type: 'reseed_word', word: 'life' });
    expect(next.wordsQueue).toEqual([]);
    expect(next.wordState.first).toBe('life');
  });
});

describe('gameReducer: reset_words + cancel_reset', () => {
  it('first reset only arms the confirmation, second reset performs it', () => {
    // Start from a dirtied state: extra discovered word + an active selection.
    const dirty = {
      ...initialGameState,
      words: { ...initialGameState.words, steam: { emoji: '♨️', from: ['fire', 'water'] } },
      wordState: { ...initialGameState.wordState, first: 'fire', second: 'water' },
    };

    const armed = gameReducer(dirty, { type: 'reset_words' });
    expect(armed.confirmReset).toBe(true);
    // Nothing destroyed yet.
    expect(armed.words.steam).toEqual({ emoji: '♨️', from: ['fire', 'water'] });
    expect(armed.wordState.first).toBe('fire');

    const reset = gameReducer(armed, { type: 'reset_words' });
    expect(reset.confirmReset).toBe(false);
    expect(reset.words).toEqual(initialGameState.words);
    expect(reset.words.steam).toBeUndefined();
    expect(reset.wordState).toEqual(initialGameState.wordState);
  });

  it('cancel_reset disarms a pending confirmation without wiping progress', () => {
    const dirty = {
      ...initialGameState,
      words: { ...initialGameState.words, steam: { emoji: '♨️', from: ['fire', 'water'] } },
    };
    const armed = gameReducer(dirty, { type: 'reset_words' });
    expect(armed.confirmReset).toBe(true);

    const cancelled = gameReducer(armed, { type: 'cancel_reset' });
    expect(cancelled.confirmReset).toBe(false);
    // Progress survives the cancel.
    expect(cancelled.words.steam).toEqual({ emoji: '♨️', from: ['fire', 'water'] });
  });
});

describe('gameReducer: loading_error', () => {
  it('clears the selected pair (so the next click starts fresh) and surfaces the kind', () => {
    const state = pairState();
    const next = gameReducer(state, { type: 'loading_error', kind: 'rate_limited' });

    // The pair is reset rather than preserved: there is no retry affordance, so
    // keeping first/second would let the next tile click silently combine the
    // stale first with whatever the user taps.
    expect(next.wordState.first).toBe('');
    expect(next.wordState.second).toBe('');
    expect(next.wordState.loading).toBe(false);
    expect(next.wordState.foundDelay).toBe(false);
    expect(next.wordState.new).toBe('');
    expect(next.wordState.error).toBe('rate_limited');
  });

  it('defaults the error kind to "generic" when none is provided', () => {
    const next = gameReducer(pairState(), { type: 'loading_error' });
    expect(next.wordState.error).toBe('generic');
    // Pair cleared.
    expect(next.wordState.first).toBe('');
    expect(next.wordState.second).toBe('');
  });

  it('drops any queued combinations so an error aborts the whole batch', () => {
    const queued = {
      ...pairState(),
      wordsQueue: [{ first: 'earth', second: 'wind' }],
    };
    const next = gameReducer(queued, { type: 'loading_error', kind: 'generic' });
    expect(next.wordsQueue).toEqual([]);
  });
});
