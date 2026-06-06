import "./App.css";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
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
// A-Z. Default is "newest": it INVERTS the prior insertion-order render (which
// put the 5 base words first and appended crafted words at the bottom) so the
// word you just made lands at the top, in view, instead of off the bottom of a
// growing grid. That's why the new-tile scroll-into-view reward is skipped in
// this mode (GameButton.jsx skipScroll) — the tile is already where the eye is.
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
// Exported so the threshold contract (set members OR any multiple of 25, with an
// n>0 guard so 0 never fires) can be unit-tested in the node env without a DOM —
// a regression guard against a future threshold tweak silently changing which
// discoveries celebrate.
export const isMilestone = (n) => MILESTONES.has(n) || (n > 0 && n % 25 === 0);

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

  // Snapshot the words present at mount (the localStorage-loaded set, via
  // initializeState) so the grid can mark what's genuinely NEW THIS SESSION vs.
  // long-ago discoveries a returning player has dozens of. Purely derived client
  // state — no reducer/localStorage change. A ref (computed once at mount) so the
  // baseline never shifts as the session's discoveries grow; the container diffs
  // the CURRENT keys against this set at render, so words crafted this session
  // (not in the snapshot) get marked and prior-session words don't.
  //
  // Reset caveat: reset_words rebuilds the map to the 5 base words, which ARE in
  // this snapshot (present at mount too — defaults or persisted), so a reset clears
  // the session dots back to the bare base set without re-snapshotting.
  //
  // Known minor inaccuracy (cosmetic only, not a state bug): the baseline is the
  // MOUNT set, never re-snapshotted. For a returning player who loads with a large
  // save, resets, then RE-crafts a word that was in that old save, the word is a
  // member of the baseline, so it gets NO "new this session" dot even though it was
  // just made this session post-reset. A word that was NOT in the old save does get
  // the dot. Acceptable for a quiet marker; the affirmative fix (track a
  // craftedThisSession set, or re-snapshot when the map shrinks to the base set)
  // is deferred since the dot is decoration, not game state.
  const sessionBaselineRef = useRef(null);
  if (sessionBaselineRef.current === null) {
    sessionBaselineRef.current = new Set(Object.keys(gameState.words));
  }

  // Replay the "+1" bump only when the total actually GROWS — not on first paint
  // (nothing was just discovered) and not on a reset's N->5 shrink (that's a
  // removal, so a celebratory scale-up would be semantically backwards). We bump
  // a remount key on growth only; the keyed span remounts and the bump keyframe
  // (App.css) replays. A ref (not state) so reading/advancing it during render
  // can't trigger an extra render. Seeded to the mount count so the first paint
  // is treated as the baseline, not a discovery.
  const prevCountRef = useRef(discoveredCount);
  const bumpKeyRef = useRef(0);
  // The bumpKey at which a milestone last fired, or -1 if none yet. Recorded in
  // the growth-only block so it shares the first-paint/reset-shrink suppression.
  // We use it (below) to (a) detect a brand-new milestone bump and (b) tie the
  // flourish's lifetime to that specific bump, not to "until the next discovery".
  // A ref (not state) so reading/advancing it during render can't trigger an
  // extra render — same rationale as bumpKeyRef.
  const milestoneKeyRef = useRef(-1);
  if (discoveredCount > prevCountRef.current) {
    bumpKeyRef.current += 1;
    if (isMilestone(discoveredCount)) {
      milestoneKeyRef.current = bumpKeyRef.current;
    }
  }
  prevCountRef.current = discoveredCount;

  // Whether THIS render's bump is the milestone one, computed synchronously from
  // the same per-render refs the keyed span is built from (advanced just above).
  // This is the half that fixes the one-frame mis-render on the discovery AFTER a
  // milestone (e.g. 50 -> 51): the span remounts at the new bumpKey, so this is
  // false immediately, gating off the gold class + "NN!" marker regardless of the
  // milestoneActive flag still lingering from the 50-bump. (milestoneActive — set
  // in a layout effect below — is the other half: it commits before paint so the
  // milestone's OWN render shows gold from the first frame, and it self-clears
  // after the animation so later non-growth re-renders, e.g. typing in the filter
  // at count 50, don't keep the gold pinned.)
  const isMilestoneBump =
    bumpKeyRef.current > 0 && milestoneKeyRef.current === bumpKeyRef.current;

  // Visible state of the milestone flourish (gold count + "NN!" marker). Unlike
  // the .bump scale — a played-out animation that's simply invisible once it
  // stops, so a lingering .bump class is harmless — the milestone adds STATIC
  // visuals (a fixed gold color + a text marker). Those must be one-shot, or they
  // pin to the counter on every later re-render. This track ADDED two non-growth
  // re-render sources right next to the counter (the grid filter input + the sort
  // toggle); without a self-clearing flag, typing one character in the filter
  // after hitting 50 would keep the gold "50!" stuck next to the count until the
  // player's next discovery. So we drive it off state that a timeout clears,
  // decoupled from "next growth".
  const [milestoneActive, setMilestoneActive] = useState(false);

  // Arm/expire the flourish from the milestone bump. milestoneKeyRef advances
  // only when a NEW milestone bump fires, so this effect runs once per milestone:
  // it shows the flourish, then hides it after the ~0.5s animation (600ms) so the
  // static gold + marker don't outlive the moment. Cleanup clears the timer if
  // another milestone fires first or the component unmounts. Keyed on
  // bumpKeyRef.current (advances on every discovery) rather than the ref value
  // directly so a non-milestone discovery between two milestones still re-runs
  // and correctly resolves to "not a milestone bump" -> hidden.
  //
  // useLayoutEffect (not useEffect): it commits the milestoneActive flip BEFORE
  // the browser paints, so on the milestone's own render the gold class +
  // marker + the larger keyframe are in place from the first painted frame
  // instead of flashing the normal bump for a frame and then restarting the
  // animation into the gold one. Together with the synchronous isMilestoneBump
  // gate above, both the milestone render and the one right after it paint
  // correctly on the first frame.
  const currentBumpKey = bumpKeyRef.current;
  useLayoutEffect(() => {
    if (currentBumpKey > 0 && milestoneKeyRef.current === currentBumpKey) {
      setMilestoneActive(true);
      const id = setTimeout(() => setMilestoneActive(false), 600);
      return () => clearTimeout(id);
    }
    // Any non-milestone bump (or first paint) leaves the flourish hidden.
    setMilestoneActive(false);
    return undefined;
  }, [currentBumpKey]);

  // Final visible state of the flourish: this render's bump must BE the milestone
  // one (synchronous, kills the post-milestone flash) AND the timed window must
  // still be open (self-clearing, kills the stuck-gold-on-later-re-render). Gates
  // both the gold class and the "NN!" marker off one value so they never diverge.
  const showMilestone = isMilestoneBump && milestoneActive;

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

  // Bumped whenever a combine is started PROGRAMMATICALLY (a lineage-chip re-seed
  // or "Surprise me") rather than by a direct tile tap. The grid container owns
  // the visual selection markers (the .selected tile highlight + the persistent
  // gold is-new ring on the last-crafted tile) and only updates them in its own
  // handleClick — which these programmatic paths bypass, since they dispatch to
  // the reducer directly. Without a signal the container would keep showing the
  // prior discovery's is-new ring through a chip/surprise combine (a stale
  // "newest" marker on a tile that's no longer the active selection). The
  // container watches this nonce and clears those markers when it advances, so a
  // programmatic combine starts from a clean grid like a manual one does. A ref
  // (not state) so advancing it in a handler doesn't itself force a render — the
  // dispatch each programmatic path also fires re-renders the tree, propagating
  // the new value to the container as a prop, where an effect keyed on it runs.
  const programmaticSelectRef = useRef(0);
  // The word(s) the grid should mark .selected when it next picks up a bump. A
  // chip re-seed leaves ONE word selected (the player picks the second tile next),
  // so the grid should highlight it like a manual first tap would. Surprise me
  // fires the combine in the same tick (both picks dispatched at once), so it
  // passes [] — there's no lasting single selection to show, just the ring-clear.
  const programmaticSelectWordsRef = useRef([]);

  // Ref to the grid's word-list container so a lineage-chip re-seed can move
  // keyboard focus there. A chip UNMOUNTS the instant it's activated (clicking it
  // dispatches reseed_word -> wordState.new=false -> the whole .combo-lineage span
  // is removed in the same commit), which would otherwise drop focus to <body>
  // (WCAG 2.4.3 Focus Order). The grid is the natural next stop — the player picks
  // the second word from these tiles — and it stays mounted across the re-seed, so
  // focus survives the chip's removal. Forwarded into GameButtonsContainer.
  const gridRef = useRef(null);

  function clickWord(word) {
    dispatch({ type: 'click_word', word });
  }

  // Lineage-chip re-seed: start a brand-new selection from one source word of the
  // just-found recipe. Uses reseed_word, NOT click_word: the chips render whenever
  // wordState.new && isFirstFound, which spans BOTH the foundDelay=true result hold
  // AND the lingering post-hold state (found_delay flips foundDelay->false on an
  // empty queue but keeps new + isFirstFound, so the chips persist and stay
  // clickable). During the foundDelay=true window a plain click_word would ENQUEUE
  // a half-pair instead of seeding a fresh pick; reseed_word always seeds
  // first=word and drops any in-flight hold, so it's correct across both states.
  // Bump the programmatic-select nonce (with this one word) so the grid both clears
  // the stale is-new ring AND highlights the re-seeded tile, matching how a manual
  // first tap looks. Then move keyboard focus off the chip (which unmounts the
  // instant new flips false) onto the still-mounted grid so it doesn't fall to
  // <body> — see the focus call below.
  function reseedWord(word) {
    programmaticSelectWordsRef.current = [word];
    programmaticSelectRef.current += 1;
    dispatch({ type: 'reseed_word', word });
    // Move focus to the still-mounted grid BEFORE the dispatch's re-render unmounts
    // the chip, so keyboard focus lands on the tiles (where the second word is
    // picked next) instead of falling to <body>. Called synchronously here: Preact
    // commits the re-render after this handler returns, and the grid container is
    // present both now and after, so the focus is stable across the chip's removal.
    // Guarded for the rare filter-emptied grid (ref unset) and non-DOM environments.
    if (gridRef.current && typeof gridRef.current.focus === "function") {
      gridRef.current.focus();
    }
  }

  // "Surprise me": pick two random owned words and run them through the SAME
  // selection flow a manual combine uses; WordCombo's effect auto-fires the
  // request once both are set. The game/server allows self-combines (Fire+Fire),
  // so two independent samples are fine even if they land on the same word.
  //
  // Seed the FIRST pick with reseed_word (not click_word) then set the second with
  // click_word. reseed_word unconditionally seeds first=word and clears wordState,
  // so it works from EVERY reachable resting state. Two plain click_words would be
  // wrong from a resting HALF-selection (one tile already tapped, second empty):
  // click_word only seeds `first` when !first, so with `first` already set both
  // randoms would take the "set second" branch — the second dispatch overwrites
  // the first, silently discarding one random pick AND keeping the player's stale
  // pre-existing first word, so it wouldn't be a two-random surprise at all.
  // reseed_word(first) wipes any half-selection first, guaranteeing BOTH randoms
  // land. (reseed_word also clears the queue, which a surprise should never have.)
  //
  // Guarded against firing mid-combine: we no-op while a combine is in flight or
  // in its result hold (the same gate the button reflects) so we never start an
  // overlapping request. Bumps the programmatic-select nonce too, so the grid
  // clears the prior discovery's stale is-new ring as this surprise combine begins
  // (it bypasses the grid's own handleClick, the only place that ring is cleared).
  function surpriseMe() {
    if (gameState.wordState.loading || gameState.wordState.foundDelay) return;
    const keys = Object.keys(gameState.words);
    if (keys.length === 0) return;
    const first = keys[Math.floor(Math.random() * keys.length)];
    const second = keys[Math.floor(Math.random() * keys.length)];
    programmaticSelectWordsRef.current = [];
    programmaticSelectRef.current += 1;
    dispatch({ type: 'reseed_word', word: first });
    clickWord(second);
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
          {/* milestoneReached: a first-find that crossed a milestone count, so the
              combo-result live region can fold a milestone cue into the single
              sentence it already announces (the visual gold flourish is
              aria-hidden, so without this AT users get no signal that a round
              number was crossed). Derived from the current state + count, not the
              transient showMilestone flag, so it stays stable for the whole
              RESULT_HOLD window and the live region announces it exactly once. */}
          <WordCombo
            wordState={gameState.wordState}
            words={gameState.words}
            loadingWord={loadingWord}
            newWord={newWord}
            loadingError={loadingError}
            onSelectWord={reseedWord}
            milestoneReached={
              !!gameState.wordState.new &&
              gameState.wordState.isFirstFound &&
              isMilestone(discoveredCount)
            }
          />
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
                ? showMilestone
                  ? " bump milestone"
                  : " bump"
                : ""
            }`}
          >
            {discoveredCount} discovered
            {/* One-beat inline marker on the milestone span only. Driven by the
                same showMilestone value as the gold class, so it shows for the
                ~0.5s flourish on the milestone discovery and then clears — it does
                NOT linger through later filter/sort re-renders, and it does NOT
                flash on the discovery right after a milestone.
                aria-hidden: the visual "50!" is decorative emphasis on the
                already-present "50 discovered" count, so it shouldn't double up
                for a screen reader (and the count line itself is visual-only —
                WordCombo's status region owns the announcement). */}
            {showMilestone ? (
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
            {/* "Surprise me": one tap combines two random owned tiles for a player
                who's stalled. Gated off while a combine is loading or in its result
                hold so it respects the same gate the reducer enforces and never
                starts an overlapping request — surpriseMe() no-ops on exactly that
                condition. Uses aria-disabled (not the disabled ATTRIBUTE) so the
                button stays focusable across the combine: a real `disabled` can't
                hold focus, so a keyboard user who triggers it would lose focus to
                <body> for the combine's duration (WCAG 2.4.3). aria-disabled keeps
                it in the a11y tree as "dimmed/unavailable" while the handler's own
                guard absorbs the keypress, so focus stays put. Styled like
                .sort-toggle (the [aria-disabled] CSS mirrors the old :disabled
                dim). */}
            <button
              type="button"
              className="surprise-button"
              onClick={surpriseMe}
              aria-disabled={gameState.wordState.loading || gameState.wordState.foundDelay}
              aria-label="Combine two random words"
              title="Surprise me"
            >
              🎲
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
          isFirstFound={gameState.wordState.isFirstFound}
          sessionBaseline={sessionBaselineRef.current}
          programmaticSelectNonce={programmaticSelectRef.current}
          programmaticSelectWords={programmaticSelectWordsRef.current}
          containerRef={gridRef}
        />
      </div>
      <ResetButton confirmReset={gameState.confirmReset} resetWords={resetWords} />
    </div>
  );
}

export default App;

