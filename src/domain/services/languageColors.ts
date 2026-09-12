/**
 * Wall colours follow GitHub Linguist so a visitor recognises their own stack at a
 * glance. The table is bundled rather than fetched: one more network round trip would
 * spend the unauthenticated budget the repository listing already competes for.
 */
const LANGUAGE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  typescript: '#3178c6',
  javascript: '#f1e05a',
  python: '#3572a5',
  rust: '#dea584',
  go: '#00add8',
  java: '#b07219',
  kotlin: '#a97bff',
  swift: '#f05138',
  'c++': '#f34b7d',
  c: '#555555',
  'c#': '#178600',
  ruby: '#701516',
  php: '#4f5d95',
  dart: '#00b4ab',
  elixir: '#6e4a7e',
  haskell: '#5e5086',
  lua: '#000080',
  perl: '#0298c3',
  r: '#198ce7',
  scala: '#c22d40',
  clojure: '#db5855',
  ocaml: '#3be133',
  zig: '#ec915c',
  html: '#e34c26',
  css: '#563d7c',
  scss: '#c6538c',
  vue: '#41b883',
  svelte: '#ff3e00',
  shell: '#89e051',
  'objective-c': '#438eff',
  'jupyter notebook': '#da5b0b',
  glsl: '#5686a5',
  nix: '#7e7eff',
  solidity: '#aa6746',
});

/** Repositories GitHub could not classify still need a wall; they get slate grey. */
export const UNKNOWN_LANGUAGE_COLOR = '#6e7681';

export function colorForLanguage(language: string | null): string {
  if (language === null) return UNKNOWN_LANGUAGE_COLOR;
  const key = language.trim().toLowerCase();
  // A plain index would answer for inherited keys: "constructor" returns a function and
  // "__proto__" an object, and the fork path then calls slice on it and throws.
  return Object.hasOwn(LANGUAGE_COLORS, key) ? LANGUAGE_COLORS[key] ?? UNKNOWN_LANGUAGE_COLOR : UNKNOWN_LANGUAGE_COLOR;
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHex(color: string): readonly [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function toHex(channels: readonly [number, number, number]): string {
  return `#${channels.map(channel => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Forks are pulled toward grey rather than given a shape of their own. The skyline
 * should read as one city, and a second building form would compete with the height
 * and window signals that carry the actual information.
 */
export function desaturate(color: string, amount: number): string {
  const [red, green, blue] = parseHex(color);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const mix = Math.min(1, Math.max(0, amount));
  return toHex([
    red + (luminance - red) * mix,
    green + (luminance - green) * mix,
    blue + (luminance - blue) * mix,
  ]);
}
