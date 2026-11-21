import { describe, it, expect } from "vitest";
import { submissionToWebhookBody } from "../adapter";

const questions = [
  { id: "q1", type: "INPUT_TEXT", title: "Nom" },
  { id: "q2", type: "INPUT_EMAIL", title: "Email" },
  { id: "q3", type: "CHECKBOXES", title: "Options" },
  { id: "q4", type: "INPUT_TEXT", title: "Supprimée", isDeleted: true },
  { id: "q5", type: "TEXTAREA", title: "Message" },
];

const submission = {
  id: "sub_1",
  formId: "frm",
  isCompleted: true,
  submittedAt: "2026-10-01T10:00:00.000Z",
  responses: [
    { questionId: "q5", answer: "Bonjour", formattedAnswer: "Bonjour" },
    { questionId: "q1", answer: "Ada" },
    { questionId: "q3", answer: ["a", "b"], formattedAnswer: "a, b" },
  ],
};

describe("submissionToWebhookBody", () => {
  const body = submissionToWebhookBody(submission, questions, { id: "frm", name: "Contact" });

  it("reprend l'enveloppe du webhook Tally", () => {
    expect(body.eventId).toBe("sub_1");
    expect(body.eventType).toBe("FORM_RESPONSE");
    expect(body.createdAt).toBe("2026-10-01T10:00:00.000Z");
    expect(body.data).toMatchObject({ responseId: "sub_1", submissionId: "sub_1", formId: "frm", formName: "Contact" });
  });

  it("suit l'ordre des questions, pas celui des réponses", () => {
    expect(body.data.fields.map((f) => f.key)).toEqual(["q1", "q2", "q3", "q5"]);
    expect(body.data.fields[0]).toEqual({ key: "q1", label: "Nom", type: "INPUT_TEXT", value: "Ada" });
  });

  it("garde les questions sans réponse (null) pour stabiliser les index, omet les supprimées", () => {
    expect(body.data.fields[1].value).toBeNull();
    expect(body.data.fields.some((f) => f.key === "q4")).toBe(false);
    expect(body.data.fields[2].value).toEqual(["a", "b"]);
  });

  it("deux soumissions donnent le même index pour la même question", () => {
    const other = submissionToWebhookBody({ ...submission, id: "s2", responses: [] }, questions, { id: "frm", name: "Contact" });
    expect(other.data.fields.map((f) => f.key)).toEqual(body.data.fields.map((f) => f.key));
  });
});
