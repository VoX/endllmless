import "./Spinner.css";

// On-brand loading cue: two dots (the ::before/::after pseudo-elements) pulse
// toward each other and merge, echoing the game's core verb — two words
// becoming one. The inner <span> is the "merge flash" accent that flares at
// the center as they meet. role/aria-label are unchanged so a11y is identical
// to the old ring spinner.
export const Spinner = () => (
  <div className="spinner" role="img" aria-label="Combining words, loading">
    <span className="spinner-merge" aria-hidden="true"></span>
  </div>
);
