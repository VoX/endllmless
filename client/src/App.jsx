import "./App.css";
import { useEffect, useReducer, useState } from "react";
import { GameButtonsContainer } from "./GameButton";
import { TitleHeader } from "./TitleHeader";
import { gameReducer, initialGameState, initializeState } from "./gameReducer";
import { WordCombo } from "./WordCombo";
import { ResetButton } from "./ResetButton";

function App() {
  const [gameState, dispatch] = useReducer(gameReducer, initialGameState, initializeState);
  const [hintDismissed, setHintDismissed] = useState(false);

  // Show the onboarding hint until the player has discovered more than the 5
  // default words, or until they dismiss it manually.
  const showHint = !hintDismissed && Object.keys(gameState.words).length <= 5;

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
    await new Promise(r => setTimeout(r, 500));
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
        <GameButtonsContainer onClickWord={clickWord} words={gameState.words} />
      </div>
      <ResetButton confirmReset={gameState.confirmReset} resetWords={resetWords} />
    </div>
  );
}

export default App;

