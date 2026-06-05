import { useEffect } from "preact/hooks";
import { SelectedWord } from "./SelectedWord";
import { Spinner } from "./Spinner";
import "./WordCombo.css";

// Floor the spinner to a short minimum so a genuine LLM call still reads as
// "thinking" while a server cache hit (near-instant — the lookup is synchronous
// in-memory on the server) snaps quickly. Sized to the spinner's merge-flash
// apex: the converging-dots animation (Spinner.css) and the reduced-motion
// breathe (index.css) both peak at ~half their 1.1s / 1.4s cycle, so 550ms lets
// the "two dots become one" payoff land at least once on a fast hit instead of
// the dots vanishing before they meet — while still feeling far snappier than
// the old 2s floor. The Promise.all race below guarantees we wait out this floor
// before resolving on a success or HTTP error; a hard network rejection still
// short-circuits it (Promise.all rejects immediately), so the spinner can flash
// briefly on a true connection failure — acceptable, since that's the rare path.
const MIN_SPINNER_MS = 550;

const wordCombineApi = async (firstWord, secondWord) => {
    const requestTask = fetch(`/api/wordcombine?wordone=${encodeURIComponent(firstWord)}&wordtwo=${encodeURIComponent(secondWord)}`);
    const response = (await Promise.all([requestTask, new Promise(r => setTimeout(r, MIN_SPINNER_MS))]))[0];
    // fetch only rejects on network failure, not on HTTP 4xx/5xx, so a server
    // error returns a valid JSON error body. Throw on it so the caller's catch
    // runs loadingError() instead of dispatching newWord(undefined, undefined).
    // Attach the status so the caller can distinguish rate limiting (429) from
    // other failures when surfacing the error to the player.
    if (!response.ok) {
        const err = new Error(`wordcombine failed: ${response.status}`);
        err.status = response.status;
        throw err;
    }
    const wordRes = await response.json();
    if (!wordRes || typeof wordRes.newWord !== "string" || !wordRes.newWord) {
        throw new Error("wordcombine returned no word");
    }
    return wordRes;
};

// Map a thrown error to the error kind stored in wordState. 429 gets its own
// throttle message; everything else (network failure with no .status, other
// HTTP errors, or a malformed-success body) falls through to a generic
// "try again".
const errorKind = (error) => (error && error.status === 429 ? 'rate_limited' : 'generic');

export const WordCombo = ({ wordState, words, loadingWord, newWord, loadingError }) => {
    useEffect(() => {
        // loading_error clears first/second, so the first+second check below is
        // already false after a failure. The extra !wordState.error guard is
        // belt-and-suspenders: it ensures the request never auto-fires while an
        // error is being shown, regardless of how the pair got set.
        if (!wordState.loading && !wordState.foundDelay && !wordState.new && !wordState.error && wordState.first && wordState.second) {
            async function makeTheRequest() {
                try {
                    const wordRes = await wordCombineApi(wordState.first, wordState.second);
                    newWord(wordRes.newWord, wordRes.newEmoji);
                }
                catch (error) {
                    loadingError(errorKind(error));
                }
            }
            loadingWord();
            makeTheRequest();
        }
    }, [wordState]);

    useEffect(() => {
        localStorage.setItem("words", JSON.stringify(words));
    }, [words]);

    // Resting state: nothing selected, nothing in flight, no result, no error.
    // Fills the otherwise-empty reserved band (min-height:50px) so the row reads
    // as "combining happens here" instead of a layout gap, and gives an in-place
    // affordance once the grid-focused onboarding hint is dismissed. Visual-only
    // (aria-hidden): the role=status region below already owns announcements, so
    // surfacing this to a screen reader would just double-speak.
    const resting =
        !wordState.first &&
        !wordState.second &&
        !wordState.new &&
        !wordState.loading &&
        !wordState.error;

    return (
        <div className="word-combo">
            {resting ? (
                <span className="combo-placeholder" aria-hidden="true">
                    <span className="combo-op">?</span>
                    <span className="combo-op">+</span>
                    <span className="combo-op">?</span>
                    <span className="combo-op">=</span>
                    <span className="combo-op">?</span>
                </span>
            ) : (
                <></>
            )}
            {wordState.first ? (
                <>
                    <SelectedWord
                        word={wordState.first}
                        emoji={words[wordState.first].emoji}
                        isFirstFound={false}
                    />
                    <span className="combo-op" aria-hidden="true">+</span>
                </>
            ) : (
                <></>
            )}
            {wordState.second ? (
                <SelectedWord
                    word={wordState.second}
                    emoji={words[wordState.second].emoji}
                    isFirstFound={false}
                />
            ) : (
                <></>
            )}
            {wordState.first && wordState.second ? (
                <span className="combo-op" aria-hidden="true">=</span>
            ) : (
                ""
            )}
            <div className="combo-result" role="status" aria-live="polite" aria-atomic="true">
                {/* Visible result is hidden from the live region so the screen
                    reader announces the self-contained sentence below instead of
                    the bare result word (which would otherwise double up). */}
                <span aria-hidden="true">
                    {wordState.new ? (
                        <>
                            <SelectedWord
                                word={wordState.new}
                                emoji={words[wordState.new].emoji}
                                isFirstFound={wordState.isFirstFound}
                            />
                            <span
                                className={`result-badge ${wordState.isFirstFound ? "result-badge-new" : "result-badge-discovered"}`}
                            >
                                {wordState.isFirstFound ? "New!" : "already discovered"}
                            </span>
                            {/* Lineage on a fresh find only: the "X + Y" recipe the
                                player just grew. aria-hidden so it doesn't double the
                                self-contained combo sentence the live region already
                                announces below; the badge itself is already hidden,
                                but the source pair lives on words[new].from. */}
                            {wordState.isFirstFound && words[wordState.new]?.from ? (
                                <span className="combo-lineage">
                                    {`${words[wordState.new].from[0]} + ${words[wordState.new].from[1]}`}
                                </span>
                            ) : (
                                ""
                            )}
                        </>
                    ) : wordState.loading ? (
                        <Spinner />
                    ) : (
                        ""
                    )}
                </span>
                {wordState.first && wordState.second && wordState.new ? (
                    <span className="visually-hidden">
                        {/* Fold the new-vs-rediscovered distinction (shown visually
                            by the aria-hidden badge) into the announced sentence so
                            screen-reader users get the same signal. */}
                        {`${wordState.first} plus ${wordState.second} equals ${wordState.new}${wordState.isFirstFound ? ", a new discovery" : ", already discovered"}`}
                    </span>
                ) : wordState.first && wordState.second && wordState.loading ? (
                    <span className="visually-hidden">
                        {`combining ${wordState.first} and ${wordState.second}`}
                    </span>
                ) : (
                    ""
                )}
            </div>
            {wordState.error ? (
                <span className="word-combo-error" role="alert">
                    {wordState.error === 'rate_limited'
                        ? "slow down a sec"
                        : "that didn't work, try again"}
                </span>
            ) : (
                <></>
            )}
        </div>
    );
};