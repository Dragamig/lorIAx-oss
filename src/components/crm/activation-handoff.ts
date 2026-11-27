const KEY = "crm.activation.handoff";

/** Résultat des automatismes d'exemple, transmis de la modale d'activation à l'écran Raccordement. */
export interface ActivationHandoff {
  created: string[];
  skipped: string[];
  statusOptionsAdded: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function saveActivationHandoff(data: Partial<ActivationHandoff>): void {
  const value: ActivationHandoff = {
    created: strings(data.created),
    skipped: strings(data.skipped),
    statusOptionsAdded: strings(data.statusOptionsAdded),
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* stockage indisponible : le récapitulatif n'est simplement pas affiché */
  }
}

/** Lit puis efface : le récapitulatif ne s'affiche qu'une fois. */
export function takeActivationHandoff(): ActivationHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(KEY);
    const j = JSON.parse(raw) as Partial<ActivationHandoff>;
    return { created: strings(j.created), skipped: strings(j.skipped), statusOptionsAdded: strings(j.statusOptionsAdded) };
  } catch {
    return null;
  }
}
