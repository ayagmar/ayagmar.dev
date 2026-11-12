// Its own module: every script counts something, and /uses needs nothing else in src/lib/words.ts.

/** `1,204`. */
export const count = (value: number) => value.toLocaleString('en');

/** `3 commits`, `1 commit`, `1,204 days`. */
export const plural = (value: number, one: string, many: string) =>
  `${count(value)} ${value === 1 ? one : many}`;

/** `a, b and c`; `a and b`; `a`. */
export const list = (names: readonly string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
