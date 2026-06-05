import { useEffect } from "preact/hooks";
import { SelectedWord } from "./SelectedWord";
import { Spinner } from "./Spinner";
import "./WordCombo.css";

const wordCombineApi = async (firstWord, secondWord) => {
    const requestTask = fetch(`/api/wordcombine?wordone=${encodeURIComponent(firstWord)}&wordtwo=${encodeURIComponent(secondWord)}`);
    const response = (await Promise.all([requestTask, new Promise(r => setTimeout(r, 2000))]))[0];
    // fetch only rejects on network failure, not on HTTP 4xx/5xx, so a server
    // error returns a valid JSON error body. Throw on it so the caller's catch
    // runs loadingError() instead of dispatching newWord(undefined, undefined).
    if (!response.ok) {
        throw new Error(`wordcombine failed: ${response.status}`);
    }
    const wordRes = await response.json();
    if (!wordRes || typeof wordRes.newWord !== "string" || !wordRes.newWord) {
        throw new Error("wordcombine returned no word");
    }
    return wordRes;
};

export const WordCombo = ({ wordState, words, loadingWord, newWord, loadingError }) => {
    useEffect(() => {
        if (!wordState.loading && !wordState.foundDelay && !wordState.new && wordState.first && wordState.second) {
            async function makeTheRequest() {
                try {
                    const wordRes = await wordCombineApi(wordState.first, wordState.second);
                    newWord(wordRes.newWord, wordRes.newEmoji);
                }
                catch (error) {
                    loadingError();
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
                {wordState.new ? (
                    <SelectedWord
                        word={wordState.new}
                        emoji={words[wordState.new]}
                        isFirstFound={wordState.isFirstFound}
                    />
                ) : wordState.loading ? (
                    <Spinner />
                ) : (
                    ""
                )}
            </div>
        </div>
    );
};