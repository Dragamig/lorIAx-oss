/**
 * Adaptateur : soumission de l'API Tally -> corps identique à celui du webhook
 * Tally, pour que `variables.body.data.fields.N.value` s'adresse pareil.
 *
 * L'ordre des champs est celui des questions du formulaire (comme le webhook),
 * y compris pour les questions sans réponse (valeur null), afin que les index
 * restent stables d'une soumission à l'autre. Les questions supprimées sont omises.
 */
import type { TallyQuestion, TallySubmission } from "./client";

export interface TallyWebhookField {
  key: string;
  label: string;
  type: string;
  value: unknown;
}

export interface TallyWebhookBody {
  eventId: string;
  eventType: "FORM_RESPONSE";
  createdAt: string;
  data: {
    responseId: string;
    submissionId: string;
    formId: string;
    formName: string;
    fields: TallyWebhookField[];
  };
}

export function submissionToWebhookBody(
  submission: TallySubmission,
  questions: TallyQuestion[],
  form: { id: string; name: string }
): TallyWebhookBody {
  const answers = new Map<string, { answer: unknown; formattedAnswer?: string }>();
  for (const r of submission.responses ?? []) answers.set(r.questionId, r);

  const fields: TallyWebhookField[] = questions
    .filter((q) => !q.isDeleted)
    .map((q) => {
      const r = answers.get(q.id);
      let value: unknown = null;
      if (r) {
        value = r.answer ?? (r.formattedAnswer !== undefined ? r.formattedAnswer : null);
      }
      return { key: q.id, label: q.title, type: q.type, value };
    });

  return {
    eventId: submission.id,
    eventType: "FORM_RESPONSE",
    createdAt: submission.submittedAt,
    data: {
      responseId: submission.id,
      submissionId: submission.id,
      formId: submission.formId || form.id,
      formName: form.name,
      fields,
    },
  };
}
