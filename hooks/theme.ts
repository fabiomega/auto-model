// Colors named by meaning, so every drawing follows the person's own theme:
// the desktop app is often light, the terminal often dark, and a fixed hex
// gold is unreadable on white.
export const C = {
  accent: 'claude',
  text: 'text',
  muted: 'inactive',
  hair: 'subtle',
  good: 'success',
  warn: 'warning',
  bad: 'error',
  ink: 'inverseText',
} as const

// Only the terminal draws in one monospaced cell grid, where box-drawing
// numerals line up; every other surface sets text in proportional type.
export function isGrid(surface: string): boolean {
  return surface === 'terminal'
}
