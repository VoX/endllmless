const defaultWords = {
    earth: "⛰️",
    fire: "🔥",
    life: "🌿",
    water: "💦",
    wind: "🌬️",
};

// The five primordial elements. Exported (keys only) so the tile grid can give
// the starting set a distinct "foundational" treatment vs. crafted words. Kept
// as a frozen snapshot of the keys so consumers can't accidentally mutate the
// source object, and so the reducer's own use of defaultWords is unaffected.
export const baseWords = Object.freeze(Object.keys(defaultWords));

const defaultWordState = {
    first: "",
    second: "",
    new: "",
    isFirstFound: false,
    loading: false,
    foundDelay: false,
    error: ""
};

export const initialGameState = {
    words: defaultWords,
    wordsQueue: [],
    wordState: defaultWordState,
    confirmReset: false,
};

export const initializeState = (initialValue) => {
    // Guard against corrupted/non-JSON persisted state (browser glitch, another
    // script on the origin, manual tampering, partial write). A throw here would
    // crash reducer init and blank the whole app with no recovery, so fall back
    // to the defaults and only adopt the stored value when it's a plain object.
    try {
        const stored = JSON.parse(localStorage.getItem("words"));
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
            initialValue.words = stored;
        }
    } catch {
        // Keep defaultWords; nothing to adopt.
    }
    return initialValue;
};

export function gameReducer(state, action) {
    return innerGameReducer(state, action);
}

function innerGameReducer(state, action) {
    switch (action.type) {
        case 'reset_words': {
            return state.confirmReset ? {
                ...state,
                words: defaultWords,
                wordState: defaultWordState,
                confirmReset: false
            } : {
                ...state,
                confirmReset: true
            };
        }
        case 'cancel_reset': {
            // Revert the pending "Are You Sure?" confirmation (e.g. the 3s
            // safety timeout elapsed without a confirming second click).
            return { ...state, confirmReset: false };
        }
        case 'click_word': {
            if (state.wordState.loading || state.wordState.foundDelay) {
                if (state.wordsQueue.length && !state.wordsQueue[state.wordsQueue.length - 1].second) {
                    const newQueue = [...state.wordsQueue];
                    newQueue[newQueue.length - 1].second = action.word;
                    return { ...state, wordsQueue: newQueue };
                }
                else {
                    return {
                        ...state,
                        wordsQueue: [...state.wordsQueue, { first: action.word, second: "" }]
                    };
                }
            }
            if (!state.wordState.first || state.wordState.new) {
                return {
                    ...state,
                    wordState: { ...defaultWordState, first: action.word },
                    confirmReset: false
                };
            }
            return {
                ...state,
                wordState: { ...defaultWordState, first: state.wordState.first, second: action.word },
                confirmReset: false
            };
        }
        case 'loading_word': {
            return {
                ...state,
                wordState: { ...state.wordState, loading: true }
            };
        }
        case 'new_word': {
            return {
                ...state,
                wordState: {
                    ...state.wordState,
                    foundDelay: true,
                    loading: false,
                    new: action.word,
                    // Clear any prior error so a successful discovery never renders
                    // alongside a stale failure message. Defensive: the only path
                    // that reaches new_word today comes through a cleared error, but
                    // don't depend on that invariant holding elsewhere.
                    error: "",
                    isFirstFound: !Object.keys(state.words).includes(action.word)
                },
                words: { ...state.words, ...{ [action.word]: action.emoji } },
            };
        }
        case 'loading_error': {
            // Clear the selected pair (so the next tile click starts a fresh
            // selection rather than silently combining the stale `first` with it)
            // and surface the failure kind via `error`. There is no retry
            // affordance in the UI, so retaining first/second only created a trap;
            // the user re-selects from scratch. Also drop any queued combinations:
            // an error aborts the whole queued batch instead of letting orphaned
            // pairs resurface on a later found_delay.
            return {
                ...state,
                wordsQueue: [],
                wordState: { ...defaultWordState, error: action.kind || 'generic' }
            };
        }
        case 'found_delay': {
            if (!state.wordsQueue.length) {
                return { ...state, wordState: { ...state.wordState, foundDelay: false } };
            }
            const [next, ...remainingQueue] = state.wordsQueue;
            return {
                ...state,
                wordsQueue: remainingQueue,
                wordState: { ...defaultWordState, ...next }
            };
        }
    }
    throw Error('Unknown action: ' + action.type);
}