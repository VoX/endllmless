export const ResetButton = ({ confirmReset, resetWords }) => {
    return (
        <div className="reset-bar">
            <button
                type="button"
                className={`reset-button${confirmReset ? " confirm" : ""}`}
                onClick={resetWords}
            >
                {confirmReset ? "Are You Sure?" : "Reset Words"}
            </button>
        </div>
    );
};