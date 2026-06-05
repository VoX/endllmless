import { useEffect, useRef, useState } from "preact/hooks";
import { baseWords } from "./gameReducer.js";
import "./GameButton.css";

// Set for O(1) "is this one of the five primordial elements?" checks in render.
const baseWordSet = new Set(baseWords);

// Honor the OS reduced-motion preference for the scroll-into-view reward: smooth
// scroll when motion is allowed, instant jump otherwise. Guarded for non-browser
// / older environments where matchMedia may be absent.
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// New-tile entrance: a short scale+fade pop so a freshly crafted word arrives
// with "a beat of motion" instead of blinking in at full size (README theory:
// the reveal should land). Kept in sync with the tile-enter @keyframes duration
// in GameButton.css. The is-new ring (box-shadow) can run alongside this, but
// the 1s tada (transform:scale) cannot — two scale animations on one element
// fight — so tada is deferred until this entrance finishes (see the effect
// below), and this duration is how long we wait.
const TILE_ENTER_MS = 220;

// Case-insensitive substring match for the grid filter. An empty/whitespace-only
// query matches everything (no filtering). Shared by the render-time .filter and
// the new-tile scroll guard so "is this word currently shown?" is decided one way.
// Exported (like migrateWords) so the empty-query/trim/case-insensitive contract
// the container depends on can be unit-tested in the node env without a DOM.
export const matchesQuery = (word, query) => {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  return word.toLowerCase().includes(q);
};

// Derive the grid's render order from the raw discovery-order word keys.
// "newest" = most recent discovery on top (insertion order reversed); "alpha" =
// case-insensitive A-Z. `words` stays the source of truth — this only reorders
// the keys for rendering, so all word-keyed state (is-new, base-tile, selected)
// is unaffected. Exported (like migrateWords) so the sort branches can be
// unit-tested in the node env without a DOM.
export const orderWords = (keys, sortMode) => {
  if (sortMode === "alpha") {
    // Copy before sorting: never mutate the caller's array (Object.keys result
    // is fresh here, but keep the function pure for any future reuse).
    return [...keys].sort((a, b) => a.localeCompare(b));
  }
  if (sortMode === "newest") {
    return [...keys].reverse();
  }
  return keys;
};

// word: string, onClick: Function
const GameButton = ({ emoji, onClick, word }) => {
  return (
    <button
      type="button"
      className="game-button"
      onClick={onClick ? () => onClick(word) : () => undefined}
      aria-label={word}
    >
      <p className="game-button-emoji" aria-hidden="true">{emoji}</p>
      <p className="game-button-label">{word}</p>
    </button>
  );
};

// words: { [word]: { emoji, from } }
// queueEmpty: boolean (no further queued combines pending)
// filter: string (live substring filter for the grid; "" = no filtering)
// sortMode: "newest" | "alpha" (grid render order)
export const GameButtonsContainer = ({ onClickWord, words, queueEmpty, filter = "", sortMode = "newest" }) => {
  const [tadaWord, setTadaWord] = useState(null);
  // The just-crafted tile currently playing its one-shot entrance pop. Cleared
  // after the entrance finishes so the class doesn't re-apply on later renders.
  const [enterWord, setEnterWord] = useState(null);
  // Latest queueEmpty in a ref so the new-tile effect (which must stay keyed on
  // `words` so it only fires when a tile actually appears) can read the current
  // value without adding it to the dep array and re-running on every queue tick.
  const queueEmptyRef = useRef(queueEmpty);
  queueEmptyRef.current = queueEmpty;
  // Latest filter/sortMode in refs for the same reason: the new-tile effect must
  // stay keyed on `words` only, but its scroll-guard needs the CURRENT filter and
  // sort to decide whether the new tile is actually visible (and on top).
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const sortModeRef = useRef(sortMode);
  sortModeRef.current = sortMode;
  // Persistent accent ring on the most recently crafted word. Unlike the 1s
  // transient `tada`, this stays until the next selection/combine starts so a
  // brand-new tile doesn't immediately blend back into the grid. Local state
  // only — no new global/reducer state.
  const [newWord, setNewWord] = useState(null);
  const [selectedWords, setSelectedWords] = useState([]);
  const [fadeOutWords, setFadeOutWords] = useState([]);
  const prevWords = useRef(Object.keys(words));
  // word -> tile button element, so a freshly crafted tile (which appends at the
  // end of the flex-wrap grid, often below the fold) can be scrolled into view.
  const tileRefs = useRef(new Map());
  // Pending entrance/tada setTimeout ids for the current new-tile sequence. The
  // sequence schedules deferred setEnterWord(null)/setTadaWord(...) calls keyed
  // to a SPECIFIC word; if that word vanishes first (a reset, or any word-set
  // shrink) the shrink-cleanup branch clears these so they can't fire afterward
  // and re-assign tada/enter to a now-gone tile (a stray tada could then land on
  // that exact word if it's rediscovered within the ~1s window). Also cleared
  // when a fresh sequence starts so back-to-back discoveries don't leak the prior
  // timers.
  const sequenceTimers = useRef([]);
  const clearSequenceTimers = () => {
    sequenceTimers.current.forEach(clearTimeout);
    sequenceTimers.current = [];
  };

  // Track new word for tada animation
  useEffect(() => {
    const currentWords = Object.keys(words);
    let tadaTarget = null;
    if (currentWords.length > prevWords.current.length) {
      const found = currentWords.find((w) => !prevWords.current.includes(w));
      tadaTarget = found;
    }
    // Always fade out highlight after a selection attempt
    if (tadaTarget) {
      // Entrance pop FIRST, then tada — both animate transform:scale on the
      // same tile, so running them concurrently would double-scale and jank.
      // The entrance is a one-shot class cleared after TILE_ENTER_MS; tada is
      // deferred to start only once the entrance has finished. (Under reduced
      // motion the entrance CSS is opacity-only/instant and tada is fully
      // neutralized in CSS, so this sequencing is a no-op there — but the same
      // code path runs harmlessly.)
      setEnterWord(tadaTarget);
      setTadaWord(null);
      // Drop any timers still pending from a prior new-tile sequence before
      // arming this one (rapid back-to-back discoveries), then track the new ids
      // so the shrink-cleanup branch below can cancel them if tadaTarget vanishes.
      clearSequenceTimers();
      sequenceTimers.current.push(
        setTimeout(() => setEnterWord(null), TILE_ENTER_MS),
        setTimeout(() => setTadaWord(tadaTarget), TILE_ENTER_MS),
        setTimeout(() => setTadaWord(null), TILE_ENTER_MS + 1000)
      );
      // Persistent ring + scroll the reward into view. The tile is already in
      // the DOM (this effect runs after the render that added it), so its ref is
      // populated. Smooth scroll when motion is allowed; instant under reduce.
      setNewWord(tadaTarget);
      const tileEl = tileRefs.current.get(tadaTarget);
      // Only skip the scroll for a tile that genuinely isn't on screen as the
      // reward: one excluded by the active filter isn't rendered at all, so
      // there's nothing to scroll to (its ref is also gone). We do NOT skip on
      // sortMode anymore: in "newest" the new tile is at the grid TOP, but the
      // player is often scrolled to the BOTTOM (combining with a base element,
      // which sits at the bottom in newest), so the entrance pop + new ring would
      // play above the fold, unseen. The visibility measurement below decides
      // whether a scroll is actually needed in either sort.
      const matchesFilter = matchesQuery(tadaTarget, filterRef.current);
      const skipScroll = !matchesFilter;
      // Only scroll on the LAST tile of a batch (queue drained). During a rapid
      // multi-combine each resolved word appends lower in the grid and would be
      // off-screen, so without this gate the viewport chases the grid bottom
      // across the whole batch — stealing the player from the result celebration
      // in the sticky topbar and stacking N fighting smooth-scrolls. When more
      // combines are still queued we leave the viewport put and let the final
      // resolution do the single scroll.
      if (!skipScroll && queueEmptyRef.current && tileEl && typeof tileEl.scrollIntoView === "function") {
        // Treat the region behind the sticky, z-indexed topbar (App.css .topbar)
        // as NOT visible: on narrow screens it stacks several rows (wrapped
        // title + combo + discovery line + grid controls + optional error), so a
        // tile whose top sits just below 0 can still be occluded by the bar.
        // Measure the live bar height instead of assuming a fixed offset, and
        // only skip the scroll when the tile is fully clear of it.
        const topbarEl =
          typeof document !== "undefined" ? document.querySelector(".topbar") : null;
        const topbarBottom = topbarEl ? topbarEl.getBoundingClientRect().bottom : 0;
        const r = tileEl.getBoundingClientRect();
        const visible = r.top >= topbarBottom && r.bottom <= window.innerHeight;
        if (!visible) {
          // scrollIntoView({block:"nearest"}) honors only the STATIC
          // scroll-margin-top (var(--space-4), 24px) from GameButton.css, but the
          // topbar now stacks up to 4-5 rows and on a narrow viewport with a
          // wrapped title is far taller than 24px. So when the tile aligns to the
          // TOP (it's above the fold — the common "newest" case where the player
          // is scrolled down), a 24px clearance leaves it partly behind the bar.
          // Set the clearance to the measured bar height (+ a small gap) right
          // before scrolling so the gate and the landing position agree; the
          // static CSS value stays as the no-measurement fallback. Cleared after
          // the scroll so it doesn't pin a stale margin on later interactions.
          const clearance = topbarBottom > 0 ? topbarBottom + 8 : null;
          if (clearance != null) tileEl.style.scrollMarginTop = `${clearance}px`;
          tileEl.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "nearest",
          });
          if (clearance != null) {
            // Restore the stylesheet-driven margin after the scroll is scheduled
            // so it reverts to the static fallback for any future scrollIntoView.
            tileEl.style.scrollMarginTop = "";
          }
        }
      }
    }
    if (selectedWords.length === 2 || selectedWords.length === 1) {
      setFadeOutWords(selectedWords);
      setTimeout(() => setFadeOutWords([]), 1200);
      setSelectedWords([]);
    }
    // The word set shrank (reset back to the 5 defaults, or any future removal):
    // the new/tada/enter highlights point at a tile that no longer exists, so
    // clear the transient state instead of letting it dangle as stale refs. Also
    // cancel any pending entrance/tada timers — otherwise they'd fire after the
    // word is gone and re-assign tada/enter to the deleted target (and could
    // stray onto it if rediscovered within the ~1s window).
    if (currentWords.length < prevWords.current.length) {
      clearSequenceTimers();
      setNewWord(null);
      setTadaWord(null);
      setEnterWord(null);
    }
    prevWords.current = currentWords;
  }, [words]);

  // Track selected words for highlight
  function handleClick(word) {
    if (onClickWord) onClickWord(word);
    // Starting a new selection clears the persistent new-tile ring.
    setNewWord(null);
    setSelectedWords((prev) => {
      if (prev.length < 2 && !prev.includes(word)) {
        return [...prev, word];
      } else if (prev.length === 2) {
        return [word];
      } else if (prev.length === 1 && prev[0] === word) {
        // If the same button is clicked twice, keep it selected
        return [word];
      } else {
        return prev;
      }
    });
    setFadeOutWords([]); // Remove fade-out if re-selecting
  }

  // Derived render order + active filter. `words` is unchanged (source of truth);
  // we only reorder/narrow the KEYS for display, so every word-keyed visual state
  // below stays correct regardless of order or filter.
  const visibleWords = orderWords(Object.keys(words), sortMode).filter((word) =>
    matchesQuery(word, filter)
  );

  // Filter excluded everything that exists: show a muted empty state instead of a
  // blank grid so the player knows the filter is the reason, not a load failure.
  // (Only reachable when there's a non-empty query — an empty query matches all,
  // and the grid always has the 5 base words.)
  //
  // Echo the query ("no matches for ...") so a user who mistyped sees WHAT was
  // searched without hopping back to the (possibly tabbed-away) input — improves
  // recoverability of the dead end. Uses the trimmed query (matchesQuery's empty
  // contract guarantees we only get here with a non-empty trimmed query).
  //
  // No role="list" here: a list with zero listitems plus the "Select two to
  // combine them" label would be malformed + actively misleading (nothing is
  // selectable). Instead the message is a polite role="status" live region, so a
  // screen reader announces the filter-emptied result as the user types — which
  // the populated grid's static list cannot.
  if (visibleWords.length === 0) {
    return (
      <div className="game-buttons-container">
        <p className="grid-empty" role="status">
          {`no matches for "${filter.trim()}"`}
        </p>
      </div>
    );
  }

  return (
    <div
      className="game-buttons-container"
      role="list"
      aria-label="Crafted words. Select two to combine them."
    >
      {visibleWords.map((word) => {
        let btnClass = "game-button";
        if (baseWordSet.has(word)) btnClass += " base-tile";
        // One-shot entrance pop on the freshly crafted tile. Sequenced before
        // tada (see the effect) so the two scale animations never overlap.
        if (enterWord === word) btnClass += " tile-enter";
        if (tadaWord === word) btnClass += " tada";
        // Persistent new ring. The suppression below is defensive only: the new
        // tile is never the one that fades out (fadeOutWords holds the two SOURCE
        // tiles), and handleClick clears newWord before any tile can become
        // selected again — so is-new can't actually co-occur with
        // selected/fade-out. Guarding anyway keeps the backgrounds from stacking
        // if those invariants ever change.
        const isSelected = selectedWords.includes(word);
        const isFadingOut = fadeOutWords.includes(word);
        if (newWord === word && !isSelected && !isFadingOut) {
          btnClass += " is-new";
        }
        if (isSelected) btnClass += " selected";
        if (isFadingOut) btnClass += " selected fade-out";
        return (
          <div className="game-button-item" role="listitem" key={word}>
            <button
              type="button"
              className={btnClass}
              ref={(el) => {
                if (el) tileRefs.current.set(word, el);
                else tileRefs.current.delete(word);
              }}
              onClick={() => handleClick(word)}
              aria-label={word}
              aria-pressed={isSelected}
            >
              <p className="game-button-emoji" aria-hidden="true">{words[word]?.emoji}</p>
              <p className="game-button-label">{word}</p>
            </button>
          </div>
        );
      })}
    </div>
  );
};
