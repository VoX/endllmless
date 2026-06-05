import { useEffect, useState } from "preact/hooks";
import { ThemeToggle } from "./ThemeToggle";

export const TitleHeader = () => {
    const [titleWord, setTitleWord] = useState("Endless");

    useEffect(() => {
        const fetchTitle = () => {
            fetch('/api/title')
                .then(res => res.json())
                .then(data => {
                    if (data.title) {
                        setTitleWord(data.title);
                    }
                })
                .catch(err => console.error("Failed to fetch title:", err));
        };

        fetchTitle(); // Initial fetch

        const interval = setInterval(fetchTitle, Math.random() * 10000 + 5000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="title-header">
            <h1 className="title-heading">
                CRAFT {titleWord} THINGS
            </h1>
            <ThemeToggle />
        </div>
    );
};