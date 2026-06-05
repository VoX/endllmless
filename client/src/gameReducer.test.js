import { describe, it, expect } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

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

describe('gameReducer: new_word / isFirstFound', () => {
  it('marks a never-seen word as a first find and adds it to words', () => {
    const state = pairState();
    const next = gameReducer(state, { type: 'new_word', word: 'steam', emoji: '' });

    expect(next.wordState.new).toBe('steam');
    expect(next.wordState.isFirstFound).toBe(true);
    expect(next.wordState.loading).toBe(false);
    expect(next.wordState.foundDelay).toBe(true);
    // The new word is merged into the discovered set with its emoji.
    expect(next.words.steam).toBe('');
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
    // Re-merging keeps the existing emoji slot (overwritten with the same value).
    expect(next.words.water).toBe('');
  });

  it('clears any stale error so a success never renders next to a failure message', () => {
    const state = pairState({ error: 'generic' });
    const next = gameReducer(state, { type: 'new_word', word: 'steam', emoji: '' });
    expect(next.wordState.error).toBe('');
    expect(next.wordState.new).toBe('steam');
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

describe('gameReducer: reset_words + cancel_reset', () => {
  it('first reset only arms the confirmation, second reset performs it', () => {
    // Start from a dirtied state: extra discovered word + an active selection.
    const dirty = {
      ...initialGameState,
      words: { ...initialGameState.words, steam: '' },
      wordState: { ...initialGameState.wordState, first: 'fire', second: 'water' },
    };

    const armed = gameReducer(dirty, { type: 'reset_words' });
    expect(armed.confirmReset).toBe(true);
    // Nothing destroyed yet.
    expect(armed.words.steam).toBe('');
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
      words: { ...initialGameState.words, steam: '' },
    };
    const armed = gameReducer(dirty, { type: 'reset_words' });
    expect(armed.confirmReset).toBe(true);

    const cancelled = gameReducer(armed, { type: 'cancel_reset' });
    expect(cancelled.confirmReset).toBe(false);
    // Progress survives the cancel.
    expect(cancelled.words.steam).toBe('');
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
