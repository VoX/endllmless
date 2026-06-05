import "./App.css";
import { useEffect, useReducer, useRef, useState } from "react";
import { GameButtonsContainer } from "./GameButton";
import { TitleHeader } from "./TitleHeader";
import { gameReducer, initialGameState, initializeState } from "./gameReducer";
import { WordCombo } from "./WordCombo";
import { ResetButton } from "./ResetButton";

// How long the discovered result is held on screen after a successful combine,
// before found_delay clears it (and pops the next queued pair, if any). Overlaps
// the first ~500ms of the result's 1s tada (SelectedWord.css) — the celebration
// is well underway when the hold ends, not fully finished. Together with
// MIN_SPINNER_MS in WordCombo.jsx this defines how long a combine "feels" —
// spinner floor, then this result hold.
const RESULT_HOLD_MS = 500;

// Grid sort modes, persisted in localStorage like the theme choice. "newest"
// shows the most recent discovery on top (Object.keys reversed); "alpha" sorts
// A-Z. Default is "newest" so the existing append-then-celebrate flow is
// preserved for a player who never touches the control.
const SORT_KEY = "sortMode";
const SORT_MODES = ["newest", "alpha"];
function getInitialSortMode() {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    if (SORT_MODES.includes(saved)) return saved;
  } catch {
    // localStorage can throw in private mode; fall through to the default.
  }
  return "newest";
}

// Milestone thresholds for the discovery-counter flourish. Crossing one of these
// (low round numbers) or any multiple of 25 swaps the normal +1 bump for a
// slightly bigger golden one-shot — a lightweight authored hook against the
// mid-game "I made 400 things, so what?" plateau (see README theory).
const MILESTONES = new Set([10, 25, 50, 100, 250, 500]);
const isMilestone = (n) => MILESTONES.has(n) || (n > 0 && n % 25 === 0);

function App() {
  const [gameState, dispatch] = useReducer(gameReducer, initialGameState, initializeState);
  const [hintDismissed, setHintDismissed] = useState(false);
  // Live substring filter for the grid (see SearchBar below + GameButtonsContainer).
  // Empty string = no filtering. Client-only; never touches game state.
  const [filter, setFilter] = useState("");
  // Grid render order; persisted across reloads like the theme toggle.
  const [sortMode, setSortMode] = useState(getInitialSortMode);

  // Persist the chosen sort order so it survives a reload (mirrors ThemeToggle's
  // localStorage write). Failures (private mode, quota) are non-fatal — the
  // control still works for the session.
  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sortMode);
    } catch {
      // Ignore persistence failures.
    }
  }, [sortMode]);

  // The whole game loop is accumulation (the collection growing IS the progress
  // bar — see README.md), so surface the running total. Derived from game state —
  // no reducer changes; it tracks every add and falls back to the 5 defaults
  // after a reset for free.
  const discoveredCount = Object.keys(gameState.words).length;

  // Replay the "+1" bump only when the total actually GROWS — not on first paint
  // (nothing was just discovered) and not on a reset's N->5 shrink (that's a
  // removal, so a celebratory scale-up would be semantically backwards). We bump
  // a remount key on growth only; the keyed span remounts and the bump keyframe
  // (App.css) replays. A ref (not state) so reading/advancing it during render
  // can't trigger an extra render. Seeded to the mount count so the first paint
  // is treated as the baseline, not a discovery.
  const prevCountRef = useRef(discoveredCount);
  const bumpKeyRef = useRef(0);
  // Whether the discovery that triggered the current bump landed exactly ON a
  // milestone count. Computed in the same growth-only block so it shares the
  // first-paint/reset-shrink suppression: it only flips true when the count
  // actually grew INTO a milestone value, and resets to false on any other
  // (non-milestone) growth. A ref (not state) so reading/advancing it during
  // render can't trigger an extra render — same rationale as bumpKeyRef.
  const milestoneRef = useRef(false);
  if (discoveredCount > prevCountRef.current) {
    bumpKeyRef.current += 1;
    milestoneRef.current = isMilestone(discoveredCount);
  }
  prevCountRef.current = discoveredCount;

  // Show the onboarding hint until the player has discovered more than the 5
  // default words, or until they dismiss it manually.
  const showHint = !hintDismissed && discoveredCount <= 5;

  // Reset safety: once "Are You Sure?" is showing, auto-revert after 3s if the
  // player doesn't confirm with a second click. Cleanup clears the timer when
  // confirmReset flips back to false (confirm) or the component unmounts.
  useEffect(() => {
    if (!gameState.confirmReset) {
      return;
    }
    const id = setTimeout(() => {
      dispatch({ type: 'cancel_reset' });
    }, 3000);
    return () => clearTimeout(id);
  }, [gameState.confirmReset]);

  function resetWords() {
    dispatch({ type: 'reset_words' });
  }

  function clickWord(word) {
    dispatch({ type: 'click_word', word });
  }

  async function newWord(word, emoji) {
    dispatch({ type: 'new_word', word, emoji });
    await new Promise(r => setTimeout(r, RESULT_HOLD_MS));
    dispatch({ type: 'found_delay' });
  }

  function loadingWord() {
    dispatch({ type: 'loading_word' });
  }

  function loadingError(kind) {
    dispatch({ type: 'loading_error', kind });
  }

  return (
    <div className="App">
      <div className="container" style={{ margin: "auto" }}>
        <div className="topbar">
          <TitleHeader />
          <WordCombo wordState={gameState.wordState} words={gameState.words} loadingWord={loadingWord} newWord={newWord} loadingError={loadingError} />
          {/* Quiet running total of discoveries. Visual-only (no live region):
              WordCombo's combo-result region already announces the discovery
              sentence in the same render commit, so a polite live region here
              would double the screen-reader chatter on every new word. Keyed on
              a growth-only counter (bumpKeyRef) so the subtle bump animation
              (App.css) replays on each NEW word but not on first paint or a
              reset shrink; that keyframe is suppressed under
              prefers-reduced-motion there. */}
          <span
            key={bumpKeyRef.current}
            className={`discovery-count${
              bumpKeyRef.current > 0
                ? milestoneRef.current
                  ? " bump milestone"
                  : " bump"
                : ""
            }`}
          >
            {discoveredCount} discovered
            {/* One-beat inline marker on the milestone span only. aria-hidden:
                the visual "50!" is decorative emphasis on the already-present
                "50 discovered" count, so it shouldn't double up for a screen
                reader (and the count line itself is visual-only — WordCombo's
                status region owns the announcement). */}
            {bumpKeyRef.current > 0 && milestoneRef.current ? (
              <span className="discovery-milestone-marker" aria-hidden="true">
                {" "}
                {discoveredCount}!
              </span>
            ) : null}
          </span>
          {/* Grid navigation aids: live substring filter + render-order control.
              Sits below the discovery line in the sticky topbar so they're always
              reachable while scrolling a large collection. Both are client-only —
              no game/reducer state. */}
          <div className="grid-controls">
            <input
              type="search"
              className="grid-filter"
              value={filter}
              onInput={(e) => setFilter(e.currentTarget.value)}
              placeholder="Filter…"
              aria-label="Filter crafted words"
            />
            <button
              type="button"
              className="sort-toggle"
              onClick={() =>
                setSortMode((m) => (m === "newest" ? "alpha" : "newest"))
              }
              aria-label={
                sortMode === "newest"
                  ? "Sort order: newest first. Click to sort A to Z."
                  : "Sort order: A to Z. Click to sort newest first."
              }
              title={sortMode === "newest" ? "Newest first" : "A–Z"}
            >
              {sortMode === "newest" ? "newest" : "A–Z"}
            </button>
          </div>
        </div>
        {showHint ? (
          <div className="onboarding-hint" role="note">
            <span className="onboarding-hint-text">tap two things to combine them</span>
            <button
              type="button"
              className="onboarding-hint-dismiss"
              onClick={() => setHintDismissed(true)}
              aria-label="Dismiss hint"
            >
              ×
            </button>
          </div>
        ) : (
          <></>
        )}
        {/* queueEmpty gates the scroll-the-new-tile-into-view reward: during a
            rapid multi-combine batch the queue holds the pending pairs, so we
            only auto-scroll on the LAST discovery (queue drained) instead of
            chasing the grid bottom on every intermediate tile. At new_word time
            the next pair hasn't been popped yet (found_delay does that after
            RESULT_HOLD_MS), so an empty queue here means "this is the final
            tile of the batch". */}
        <GameButtonsContainer
          onClickWord={clickWord}
          words={gameState.words}
          queueEmpty={gameState.wordsQueue.length === 0}
          filter={filter}
          sortMode={sortMode}
        />
      </div>
      <ResetButton confirmReset={gameState.confirmReset} resetWords={resetWords} />
    </div>
  );
}

export default App;

