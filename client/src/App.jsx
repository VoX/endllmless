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

function App() {
  const [gameState, dispatch] = useReducer(gameReducer, initialGameState, initializeState);
  const [hintDismissed, setHintDismissed] = useState(false);

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
  if (discoveredCount > prevCountRef.current) {
    bumpKeyRef.current += 1;
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
            className={`discovery-count${bumpKeyRef.current > 0 ? " bump" : ""}`}
          >
            {discoveredCount} discovered
          </span>
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
        />
      </div>
      <ResetButton confirmReset={gameState.confirmReset} resetWords={resetWords} />
    </div>
  );
}

export default App;

