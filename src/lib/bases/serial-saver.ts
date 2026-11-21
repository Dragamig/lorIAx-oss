export type SaveOutcome = "saved" | "failed" | "superseded";

/**
 * Une seule écriture en vol à la fois : un état demandé pendant qu'une requête est en cours
 * est mémorisé (seul le dernier est gardé) et envoyé quand elle se termine. Évite qu'un état
 * ancien arrive en dernier au serveur. `save` se résout avec le sort de CET état :
 * "superseded" si un état plus récent l'a remplacé avant son envoi.
 */
export function createSerialSaver<T>(send: (value: T) => Promise<unknown>) {
  let inFlight = false;
  let queued: { value: T; resolve: (o: SaveOutcome) => void } | null = null;

  function run(value: T, resolve: (o: SaveOutcome) => void) {
    inFlight = true;
    let promise: Promise<unknown>;
    try {
      promise = send(value);
    } catch (e) {
      promise = Promise.reject(e);
    }
    promise
      .then(
        () => "saved" as const,
        () => "failed" as const,
      )
      .then((outcome) => {
        inFlight = false;
        const next = queued;
        queued = null;
        resolve(outcome);
        if (next) run(next.value, next.resolve);
      });
  }

  return {
    save(value: T): Promise<SaveOutcome> {
      return new Promise((resolve) => {
        if (inFlight) {
          queued?.resolve("superseded");
          queued = { value, resolve };
        } else {
          run(value, resolve);
        }
      });
    },
  };
}
