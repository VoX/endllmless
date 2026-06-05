// Each discovered word is stored as { emoji, from }, where `from` is the source
// pair [first, second] that first crafted it, or null for the primordial set.
// Capturing the recipe lets the collection read as a tech-tree the player grew
// (see README theory pillars #4 "build a mental model" and #6 "it compounds").
const defaultWords = {
    earth: { emoji: "⛰️", from: null },
    fire: { emoji: "🔥", from: null },
    life: { emoji: "🌿", from: null },
    water: { emoji: "💦", from: null },
    wind: { emoji: "🌬️", from: null },
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

// Normalize a persisted words blob to the current { word: { emoji, from } }
// shape. Two legacy/foreign forms are tolerated so existing saves keep working:
//   - the OLD per-entry shape { word: "🔥" } (a bare emoji string) is coerced to
//     { emoji: "🔥", from: null } — the recipe wasn't recorded back then, so it
//     reads as foundational rather than inventing a source pair;
//   - a partial/garbled object value (anything that isn't a string and lacks a
//     string `emoji`) is dropped to a safe { emoji: "", from: null } so a single
//     bad entry can't blank-render or crash a read site.
// Returns the migrated map, or null if `stored` isn't a usable plain object so
// the caller can fall back to the defaults.
export const migrateWords = (stored) => {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return null;
    }
    const migrated = {};
    for (const [word, value] of Object.entries(stored)) {
        if (typeof value === "string") {
            migrated[word] = { emoji: value, from: null };
        } else if (value && typeof value === "object") {
            migrated[word] = {
                emoji: typeof value.emoji === "string" ? value.emoji : "",
                // Preserve a well-formed source pair; otherwise treat as base. Both
                // elements must be strings — `from` is now persisted user data a
                // future surface (a collection / tech-tree view) may render
                // directly, so a garbled pair like [null, 5] shouldn't survive as
                // a "null + 5" lineage caption.
                from:
                    Array.isArray(value.from) &&
                    value.from.length === 2 &&
                    value.from.every((w) => typeof w === "string")
                        ? value.from
                        : null,
            };
        } else {
            migrated[word] = { emoji: "", from: null };
        }
    }
    return migrated;
};

export const initializeState = (initialValue) => {
    // Guard against corrupted/non-JSON persisted state (browser glitch, another
    // script on the origin, manual tampering, partial write). A throw here would
    // crash reducer init and blank the whole app with no recovery, so fall back
    // to the defaults and only adopt the stored value when it migrates cleanly.
    try {
        const migrated = migrateWords(JSON.parse(localStorage.getItem("words")));
        if (migrated) {
            initialValue.words = migrated;
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
            // Own-property check, NOT `state.words[action.word] === undefined`:
            // `words` is a plain object, so a word that collides with an inherited
            // Object.prototype member ("constructor", "toString", "valueOf",
            // "hasOwnProperty", …) would read back the inherited FUNCTION instead
            // of undefined. That would (a) wrongly mark a true first find as a
            // rediscovery and (b) store the inherited function as the entry, which
            // then blanks/crashes every downstream `.emoji` read. The server
            // returns newWord verbatim from the model, and "constructor" is an
            // ordinary English word it can emit, so this is reachable in prod.
            const isFirstFound = !Object.prototype.hasOwnProperty.call(state.words, action.word);
            const existing = isFirstFound ? undefined : state.words[action.word];
            // First path wins: record the source pair only on first discovery and
            // never clobber an existing entry's `from` on rediscovery (matches the
            // canonical-once intent). On rediscovery we keep the stored entry as-is
            // — same emoji, same lineage — so the map is unchanged for that word.
            const entry = isFirstFound
                ? { emoji: action.emoji, from: [state.wordState.first, state.wordState.second] }
                : existing;
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
                    isFirstFound
                },
                words: { ...state.words, [action.word]: entry },
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