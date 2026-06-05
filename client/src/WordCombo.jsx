import { useEffect } from "preact/hooks";
import { SelectedWord } from "./SelectedWord";
import { Spinner } from "./Spinner";
import "./WordCombo.css";

// Floor the spinner to a short minimum so a genuine LLM call still reads as
// "thinking" while a server cache hit (~5ms) snaps almost immediately. Kept
// just long enough that the spinner never flickers sub-frame; the Promise.all
// race below is what guarantees we wait out this floor before resolving.
const MIN_SPINNER_MS = 300;

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

    return (
        <div className="word-combo">
            {wordState.first ? (
                <>
                    <SelectedWord
                        word={wordState.first}
                        emoji={words[wordState.first]}
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
                    emoji={words[wordState.second]}
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
                                emoji={words[wordState.new]}
                                isFirstFound={wordState.isFirstFound}
                            />
                            <span
                                className={`result-badge ${wordState.isFirstFound ? "result-badge-new" : "result-badge-discovered"}`}
                            >
                                {wordState.isFirstFound ? "New!" : "already discovered"}
                            </span>
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