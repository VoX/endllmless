import { useEffect, useState } from "preact/hooks";

const STORAGE_KEY = "theme";

// Resolve the theme to show on first paint: an explicit saved choice wins,
// otherwise fall back to the OS preference so the icon matches what CSS renders.
function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage can throw in private mode; fall through to OS preference.
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

export const ThemeToggle = () => {
  const [theme, setTheme] = useState(getInitialTheme);

  // Reflect the active theme onto <html> so the [data-theme] token overrides apply.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore persistence failures (private mode, quota, etc.).
    }
    // Keep the browser/PWA chrome (mobile address bar, splash) in sync with the
    // explicit choice. The media-scoped <meta> tags only track the OS pref, so
    // point every theme-color tag at the chosen palette's --bg.
    const chrome = theme === "dark" ? "#142d4c" : "#eef3f8";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute("content", chrome));
  }, [theme]);

  const isDark = theme === "dark";
  const next = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      aria-pressed={!isDark}
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
    </button>
  );
};
