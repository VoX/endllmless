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

// words: string[], queueEmpty: boolean (no further queued combines pending)
export const GameButtonsContainer = ({ onClickWord, words, queueEmpty }) => {
  const [tadaWord, setTadaWord] = useState(null);
  // Latest queueEmpty in a ref so the new-tile effect (which must stay keyed on
  // `words` so it only fires when a tile actually appears) can read the current
  // value without adding it to the dep array and re-running on every queue tick.
  const queueEmptyRef = useRef(queueEmpty);
  queueEmptyRef.current = queueEmpty;
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
      setTadaWord(null);
      setTimeout(() => setTadaWord(tadaTarget), 0);
      setTimeout(() => setTadaWord(null), 1000);
      // Persistent ring + scroll the reward into view. The tile is already in
      // the DOM (this effect runs after the render that added it), so its ref is
      // populated. Smooth scroll when motion is allowed; instant under reduce.
      setNewWord(tadaTarget);
      const tileEl = tileRefs.current.get(tadaTarget);
      // Only scroll on the LAST tile of a batch (queue drained). During a rapid
      // multi-combine each resolved word appends lower in the grid and would be
      // off-screen, so without this gate the viewport chases the grid bottom
      // across the whole batch — stealing the player from the result celebration
      // in the sticky topbar and stacking N fighting smooth-scrolls. When more
      // combines are still queued we leave the viewport put and let the final
      // resolution do the single scroll.
      if (queueEmptyRef.current && tileEl && typeof tileEl.scrollIntoView === "function") {
        // Treat the region behind the sticky, z-indexed topbar (App.css .topbar)
        // as NOT visible: on narrow screens it stacks several rows (wrapped
        // title + combo + discovery line + optional error), so a tile whose top
        // sits just below 0 can still be occluded by the bar. Measure the live
        // bar height instead of assuming a fixed offset, and only skip the
        // scroll when the tile is fully clear of it. (scroll-margin-top in the
        // CSS keeps the tile off the bar when we do scroll.)
        const topbarEl =
          typeof document !== "undefined" ? document.querySelector(".topbar") : null;
        const topbarBottom = topbarEl ? topbarEl.getBoundingClientRect().bottom : 0;
        const r = tileEl.getBoundingClientRect();
        const visible = r.top >= topbarBottom && r.bottom <= window.innerHeight;
        if (!visible) {
          tileEl.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "nearest",
          });
        }
      }
    }
    if (selectedWords.length === 2 || selectedWords.length === 1) {
      setFadeOutWords(selectedWords);
      setTimeout(() => setFadeOutWords([]), 1200);
      setSelectedWords([]);
    }
    // The word set shrank (reset back to the 5 defaults, or any future removal):
    // the new/tada highlights point at a tile that no longer exists, so clear the
    // transient state instead of letting it dangle as stale refs.
    if (currentWords.length < prevWords.current.length) {
      setNewWord(null);
      setTadaWord(null);
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

  return (
    <div
      className="game-buttons-container"
      role="list"
      aria-label="Crafted words. Select two to combine them."
    >
      {Object.keys(words).map((word) => {
        let btnClass = "game-button";
        if (baseWordSet.has(word)) btnClass += " base-tile";
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
