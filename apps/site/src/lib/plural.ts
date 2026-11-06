// Its own module: every script counts something, and /uses needs nothing else in src/lib/words.ts.

/** `3 commits`, `1 commit`, `1,204 days`. */
export const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`;
