/**
 * Enregistrement d'une affectation « usage IA → fournisseur + modèle ».
 *
 * Logique extraite de l'écran d'administration pour être testable, et surtout
 * pour ne plus abandonner en silence : avant ce module, une affectation
 * incomplète était jetée sans message, et la réponse du serveur n'était jamais
 * vérifiée. L'utilisateur croyait avoir enregistré alors que rien n'avait été
 * écrit en base.
 */

export interface AssignmentPayload {
  usageType: string;
  providerId: string | null;
  model: string;
  fallbackProviderId: string | null;
  fallbackModel: string | null;
  timeoutSeconds: number;
  maxRetries: number;
  isEnabled: boolean;
}

export type AssignmentCheck = { ok: true } | { ok: false; message: string };

/**
 * Contrôle de complétude côté écran, avec le même minimum que le serveur
 * (`usageType`, `providerId`, `model`). Le message parle de fournisseur et de
 * modèle, jamais d'identifiant technique.
 */
export function checkAssignmentPayload(
  usageLabel: string,
  payload: Pick<AssignmentPayload, "providerId" | "model">,
): AssignmentCheck {
  const hasProvider = !!payload.providerId?.trim();
  const hasModel = !!payload.model?.trim();

  if (!hasProvider && !hasModel) {
    return {
      ok: false,
      message: `« ${usageLabel} » : choisissez un fournisseur et un modèle avant d'enregistrer.`,
    };
  }
  if (!hasProvider) {
    return {
      ok: false,
      message: `« ${usageLabel} » : aucun fournisseur n'est choisi, sélectionnez-en un avant d'enregistrer.`,
    };
  }
  if (!hasModel) {
    return {
      ok: false,
      message: `« ${usageLabel} » : aucun modèle n'est choisi, sélectionnez-en un avant d'enregistrer.`,
    };
  }
  return { ok: true };
}

export interface AssignmentSubmitDeps {
  /** Envoie l'affectation au serveur. Doit renvoyer le statut HTTP obtenu. */
  send: (payload: AssignmentPayload) => Promise<{ ok: boolean; status: number }>;
  /** Message d'échec destiné à l'utilisateur. */
  onError: (message: string) => void;
  /** Message de confirmation destiné à l'utilisateur. */
  onSuccess: (message: string) => void;
}

/**
 * Valide puis envoie une affectation. Renvoie `true` uniquement si le serveur
 * a confirmé l'écriture : tout autre cas produit un message lisible.
 */
export async function submitAssignment(
  usageLabel: string,
  payload: AssignmentPayload,
  deps: AssignmentSubmitDeps,
): Promise<boolean> {
  const check = checkAssignmentPayload(usageLabel, payload);
  if (!check.ok) {
    deps.onError(check.message);
    return false;
  }

  let result: { ok: boolean; status: number };
  try {
    result = await deps.send(payload);
  } catch {
    deps.onError(
      `« ${usageLabel} » : le serveur est injoignable, rien n'a été enregistré.`,
    );
    return false;
  }

  if (!result.ok) {
    deps.onError(
      result.status === 403
        ? `« ${usageLabel} » : vous n'avez pas les droits pour modifier cette affectation.`
        : `« ${usageLabel} » : l'enregistrement a échoué, rien n'a été modifié.`,
    );
    return false;
  }

  deps.onSuccess(`« ${usageLabel} » : affectation enregistrée.`);
  return true;
}
