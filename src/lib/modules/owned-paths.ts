/** Convertit un glob (`**`, `*`, littéraux) en RegExp ancrée. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/** Vrai ssi `path` correspond au pattern (glob). */
export function pathMatchesPattern(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

/**
 * Décide si un fichier doit être supprimé.
 * Pruné ssi possédé par ≥1 module exclu ET par aucun module inclus (ref-count).
 */
export function shouldPrune(
  path: string,
  includedPatterns: string[],
  excludedPatterns: string[]
): boolean {
  const ownedByExcluded = excludedPatterns.some((p) => pathMatchesPattern(path, p));
  if (!ownedByExcluded) return false;
  const ownedByIncluded = includedPatterns.some((p) => pathMatchesPattern(path, p));
  return !ownedByIncluded;
}
