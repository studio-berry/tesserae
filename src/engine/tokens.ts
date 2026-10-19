import { THEMES, TINTS, Theme } from './core'

// The one place a theme or ink colour is written down. core.ts owns the values, this writes them
// onto the document so styles.css can read the same numbers the shaders use, and App calls it
// again whenever the theme changes.
export function applyTokens(theme: Theme) {
  const root = document.documentElement.style
  const t = THEMES[theme]
  root.setProperty('--theme-bg', t.bg)
  root.setProperty('--theme-dust', t.dust)
  root.setProperty('--theme-lit', t.lit)
  for (const ink of TINTS) root.setProperty(`--ink-${ink.id}`, ink[theme])
}
