import { useEffect, useRef, useState } from "preact/hooks";
import { ThemeToggle } from "./ThemeToggle";

export const TitleHeader = () => {
    const [titleWord, setTitleWord] = useState("Endless");
    // The word being crossfaded out. While set, it's rendered stacked behind the
    // incoming word and animated away; it clears itself when its fade finishes so
    // only the live word remains in layout. null = no transition in flight.
    const [prevWord, setPrevWord] = useState(null);
    // Safety timer that clears the outgoing word even if onAnimationEnd never
    // fires — e.g. under prefers-reduced-motion (the fade is disabled, so no
    // animationend event) or in a backgrounded tab (events get throttled).
    // Without this the old word could stay stacked behind the new one forever.
    const prevTimerRef = useRef(null);
    // Keep the latest word in a ref so the swap handler can read it without
    // re-subscribing the interval (the effect stays mount-only, preserving the
    // existing randomized-interval fetch behavior).
    const titleWordRef = useRef(titleWord);

    useEffect(() => {
        const swapTitle = (next) => {
            // Only crossfade on an actual change; identical titles are a no-op so
            // we don't replay the animation or stack a duplicate word.
            if (!next || next === titleWordRef.current) {
                return;
            }
            setPrevWord(titleWordRef.current);
            titleWordRef.current = next;
            setTitleWord(next);
            // Arm the cleanup fallback (slightly longer than the ~200ms fade);
            // restart it on rapid successive swaps so it tracks the latest one.
            clearTimeout(prevTimerRef.current);
            prevTimerRef.current = setTimeout(() => setPrevWord(null), 350);
        };

        const fetchTitle = () => {
            fetch('/api/title')
                .then(res => res.json())
                .then(data => {
                    if (data.title) {
                        swapTitle(data.title);
                    }
                })
                .catch(err => console.error("Failed to fetch title:", err));
        };

        fetchTitle(); // Initial fetch

        const interval = setInterval(fetchTitle, Math.random() * 10000 + 5000);

        return () => {
            clearInterval(interval);
            clearTimeout(prevTimerRef.current);
        };
    }, []);

    return (
        <div className="title-header">
            <h1 className="title-heading">
                {/* Only the dynamic word animates; "CRAFT" and "THINGS" stay put.
                    The wrapper reserves the word's space so the outgoing copy can
                    fade/rise out from an absolute layer without shifting layout. */}
                CRAFT{" "}
                <span className="title-word-wrap">
                    <span key={titleWord} className="title-word title-word-in">
                        {titleWord}
                    </span>
                    {prevWord !== null ? (
                        <span
                            key={`prev-${prevWord}`}
                            className="title-word title-word-out"
                            aria-hidden="true"
                            onAnimationEnd={() => {
                                clearTimeout(prevTimerRef.current);
                                setPrevWord(null);
                            }}
                        >
                            {prevWord}
                        </span>
                    ) : null}
                </span>{" "}
                THINGS
            </h1>
            <ThemeToggle />
        </div>
    );
};