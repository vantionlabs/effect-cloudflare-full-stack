/**
 * Light or dark, chosen by the person and remembered in this browser.
 *
 * Beautiful UI's dark tokens are class-based (`.dark` on <html>) and nothing set the class, so dark mode existed in
 * the CSS and could not be reached. `THEME_SCRIPT` runs in <head> BEFORE first paint, so a dark-mode user never sees
 * a white flash; with no stored choice it follows the operating system. `setTheme` swaps every token at once with
 * transitions frozen for two frames (`.theme-switching`, foundation.css), so the switch is one clean repaint rather
 * than hundreds of mismatched colour fades.
 *
 * localStorage, not the server: it is a per-browser convenience, and it is read inside try/catch because storage can
 * be unavailable (private mode, blocked site data) and the page must still render.
 */
export type Theme = "light" | "dark" | "system"

const KEY = "effect-ai-theme"

export const THEME_SCRIPT =
  `(function(){try{var t=localStorage.getItem("${KEY}");var d=t==="dark"||((t===null||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`

export const readTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === "light" || stored === "dark" ? stored : "system"
  } catch {
    return "system"
  }
}

export const setTheme = (theme: Theme) => {
  const root = document.documentElement
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  root.classList.add("theme-switching")
  root.classList.toggle("dark", dark)
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")))
  try {
    if (theme === "system") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Storage unavailable: the choice holds for this page view only.
  }
}
