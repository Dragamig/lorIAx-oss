/** Neutralise les jokers LIKE (`%`, `_`) et l'echappement (`\`) saisis par l'utilisateur. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
