import "./SelectedWord.css";

export const SelectedWord = ({ word, emoji, isFirstFound }) => {
  return (
    <span className={`word ${isFirstFound ? "firstWord" : ""}`}>
      <span className="word-emoji" aria-hidden="true">{emoji}</span>
      <span className="word-label">{word}</span>
    </span>
  );
};