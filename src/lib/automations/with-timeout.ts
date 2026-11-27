/** Délai maximal d'une étape de tick avant de passer à la suivante. */
export const STEP_TIMEOUT_MS = 50_000;

/**
 * Borne une étape : au dépassement, journalise un avertissement nommant l'étape
 * et rend la main (undefined) sans interrompre l'étape, pour ne pas bloquer les suivantes.
 * Une erreur de l'étape est propagée.
 */
export async function withTimeout<T>(
  step: string,
  fn: () => Promise<T>,
  ms: number = STEP_TIMEOUT_MS,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[scheduler] étape "${step}" au-delà de ${ms} ms, on passe à la suivante`);
      resolve(undefined);
    }, ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
