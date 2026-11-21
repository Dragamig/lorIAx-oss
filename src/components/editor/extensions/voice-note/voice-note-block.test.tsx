// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import type { NodeViewProps } from "@tiptap/react";
import type { VoiceNoteState } from "./voice-note-api";

// --- doublures ------------------------------------------------------------

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/editor/extensions/synced-block/synced-content", () => ({
  SyncedContent: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}));

const currentUser = { value: { globalRole: "user" } as { globalRole: string } | null };
vi.mock("@/hooks/use-session", () => ({
  useCurrentUser: () => currentUser.value,
}));

const recorder = {
  status: "idle" as string,
  durationSeconds: 0,
  level: 0,
  error: null as string | null,
  isRecording: false,
  isPaused: false,
  start: vi.fn(async () => {}),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(async () => null),
  reset: vi.fn(),
};
vi.mock("@/hooks/use-audio-recorder", () => ({
  useAudioRecorder: () => recorder,
}));

const { VoiceNoteBlockView } = await import("./voice-note-block");

// --- utilitaires ----------------------------------------------------------

function makeState(overrides: Partial<VoiceNoteState> = {}): VoiceNoteState {
  return {
    id: "note-1",
    status: "recording",
    durationSeconds: null,
    transcript: null,
    transcriptValidatedAt: null,
    summary: null,
    cleanedText: null,
    errorCode: null,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:44:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * Avance l'horloge simulée, puis laisse les rendus déclenchés par les réponses
 * de l'API se poser. Sans ce second temps, l'assertion lit un DOM d'avance de
 * retard sur l'état réel.
 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {});
}

function renderBlock(voiceNoteId = "note-1") {
  const updateAttributes = vi.fn();
  const deleteNode = vi.fn();
  const props = {
    node: { attrs: { voiceNoteId } },
    updateAttributes,
    deleteNode,
    selected: false,
    editor: { isEditable: true },
  } as unknown as NodeViewProps;
  return { ...render(<VoiceNoteBlockView {...props} />), updateAttributes, deleteNode };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  currentUser.value = { globalRole: "user" };
  recorder.isRecording = false;
  recorder.isPaused = false;
  recorder.status = "idle";
  fetchMock = vi.fn(async () => jsonResponse(makeState()));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "__loriax_docId", {
    configurable: true,
    value: "doc-1",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// --- tests ----------------------------------------------------------------

describe("VoiceNoteBlockView, écran de repos", () => {
  it("propose l'enregistrement et le dépôt d'un fichier", async () => {
    renderBlock();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeTruthy()
    );
    expect(screen.getByText(/Déposez un fichier audio ici/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /parcourez vos fichiers/ })).toBeTruthy();
  });

  it("crée la note quand le bloc est neuf", async () => {
    const { updateAttributes } = renderBlock("");
    await waitFor(() => expect(updateAttributes).toHaveBeenCalledWith({ voiceNoteId: "note-1" }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/voice-notes");
  });

  it("relit son état au montage plutôt que de repartir de zéro", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeState({ status: "transcribing", durationSeconds: 161 }))
    );
    renderBlock();
    await waitFor(() => expect(screen.getByText("Transcription en cours")).toBeTruthy());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/voice-notes/note-1");
    expect(
      screen.getByText(/Vous pouvez fermer le document, le traitement continue/)
    ).toBeTruthy();
  });
});

describe("VoiceNoteBlockView, transcription indisponible", () => {
  it("cache le lien d'administration à un utilisateur simple", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: "transcription_unavailable" }, 503));
    renderBlock();
    await waitFor(() =>
      expect(screen.getByText(/Aucun moteur de transcription/)).toBeTruthy()
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Demandez à un administrateur/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("désactive le bloc d'emblée quand le serveur annonce l'absence de moteur", async () => {
    // Aucun enregistrement n'a encore été fait : l'information vient de la
    // lecture de la note, pas d'un envoi d'audio refusé après coup.
    fetchMock.mockResolvedValue(
      jsonResponse(makeState({ status: "recording", transcriptionAvailable: false }))
    );
    renderBlock();
    await waitFor(() =>
      expect(screen.getByText(/Aucun moteur de transcription/)).toBeTruthy()
    );
    expect(
      (screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.queryByText(/Déposez un fichier audio ici/)).toBeNull();
  });

  it("montre le lien d'administration à un administrateur", async () => {
    currentUser.value = { globalRole: "admin" };
    fetchMock.mockResolvedValue(jsonResponse({ code: "transcription_unavailable" }, 503));
    renderBlock();
    const link = await screen.findByRole("link", { name: /Administration, Transcription/ });
    expect(link.getAttribute("href")).toBe("/admin/transcription");
  });
});

describe("VoiceNoteBlockView, écran à valider", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "review",
          durationSeconds: 161,
          transcript: "Note pour la réunion de jeudi.",
          hasAudio: true,
        })
      )
    );
  });

  it("propose la réécoute tant que l'audio existe", async () => {
    renderBlock();
    expect(await screen.findByRole("button", { name: /Réécouter/ })).toBeTruthy();
  });

  it("retire la réécoute quand le serveur ne conserve plus l'audio", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "review",
          transcript: "Note pour la réunion de jeudi.",
          hasAudio: false,
        })
      )
    );
    renderBlock();
    await waitFor(() => expect(screen.getByText("À valider")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Réécouter/ })).toBeNull();
  });

  it("ouvre le transcript, corrigeable, et n'offre aucun traitement", async () => {
    renderBlock();
    await waitFor(() => expect(screen.getByText("À valider")).toBeTruthy());

    const textarea = screen.getByLabelText(
      "Transcription de la note vocale"
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Note pour la réunion de jeudi.");
    expect(screen.queryByRole("button", { name: "Synthétiser" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remettre au propre" })).toBeNull();
  });

  it("demande confirmation avant d'effacer l'audio", async () => {
    renderBlock();
    const validate = await screen.findByRole("button", { name: /Valider le transcript/ });
    fireEvent.click(validate);

    const confirm = await screen.findByRole("button", {
      name: /Valider et effacer l'audio/,
    });
    expect(screen.getByText(/efface définitivement/)).toBeTruthy();
    // Rien n'est envoyé tant que la confirmation n'est pas donnée.
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/validate"))
    ).toBe(false);

    fetchMock.mockResolvedValue(
      jsonResponse(makeState({ status: "validated", transcript: "Texte" }))
    );
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/validate"))
      ).toBe(true)
    );
  });
});

describe("VoiceNoteBlockView, écran validé", () => {
  it("propose les deux traitements et lance la synthèse", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeState({ status: "validated", transcript: "Texte" }))
    );
    renderBlock();
    await waitFor(() => expect(screen.getByText("Transcript validé")).toBeTruthy());
    expect(screen.getByText(/Audio effacé/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Synthétiser" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/process"))
      ).toBe(true)
    );
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/process"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ kind: "summary" });
  });
});

describe("VoiceNoteBlockView, correction du transcript", () => {
  it("ne réécrit pas le champ avec une réponse d'enregistrement dépassée", async () => {
    // Reproduction du défaut de production : l'enregistrement différé part,
    // l'utilisateur continue d'écrire pendant l'aller-retour, et la réponse
    // ramène le texte d'avant. Le curseur saute et la frappe est perdue.
    const base = makeState({
      status: "review",
      transcript: "Texte initial",
      hasAudio: true,
    });
    // Les enregistrements restent en vol tant qu'on ne les résout pas : c'est
    // la latence de production que le poste de développement n'a jamais.
    const pending: Array<(value: Response) => void> = [];
    fetchMock.mockImplementation(
      async (_url: string, init?: RequestInit) =>
        init?.method === "PATCH"
          ? new Promise<Response>((resolve) => pending.push(resolve))
          : jsonResponse(base)
    );

    vi.useFakeTimers();
    try {
      renderBlock();
      await tick(0);
      const textarea = screen.getByLabelText(
        "Transcription de la note vocale"
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe("Texte initial");

      // Première salve, puis départ de l'enregistrement différé.
      fireEvent.change(textarea, { target: { value: "Texte AAA initial" } });
      await tick(1000);
      // La frappe reprend, et son propre enregistrement part à son tour : deux
      // requêtes sont maintenant en vol.
      fireEvent.change(textarea, { target: { value: "Texte AAABBB initial" } });
      await tick(1000);
      expect(pending).toHaveLength(2);

      // La plus ancienne revient la première, avec le texte d'avant.
      pending[0](jsonResponse({ ...base, transcript: "Texte AAA initial" }));
      await tick(0);

      expect(
        (screen.getByLabelText("Transcription de la note vocale") as HTMLTextAreaElement)
          .value,
        "Une réponse dépassée a réécrit le champ : la frappe la plus récente " +
          "est perdue et le curseur part à la fin."
      ).toBe("Texte AAABBB initial");

      // La réponse à jour, elle, ne change rien de visible.
      pending[1](jsonResponse({ ...base, transcript: "Texte AAABBB initial" }));
      await tick(0);
      expect(
        (screen.getByLabelText("Transcription de la note vocale") as HTMLTextAreaElement)
          .value
      ).toBe("Texte AAABBB initial");
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepte encore une correction venue du serveur quand rien n'est en cours de frappe", async () => {
    // Le garde-fou ne doit pas figer le champ : hors frappe, la valeur serveur
    // reste la référence, sinon une correction faite ailleurs n'arriverait pas.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeState({ status: "review", transcript: "Première version" }))
    );
    fetchMock.mockResolvedValue(
      jsonResponse(makeState({ status: "review", transcript: "Version corrigée ailleurs" }))
    );

    vi.useFakeTimers();
    try {
      renderBlock();
      await tick(0);
      expect(
        (screen.getByLabelText("Transcription de la note vocale") as HTMLTextAreaElement)
          .value
      ).toBe("Première version");
    } finally {
      vi.useRealTimers();
    }

    // Un remontage relit l'API : la nouvelle valeur s'installe.
    renderBlock();
    await waitFor(() => {
      const fields = screen.getAllByLabelText(
        "Transcription de la note vocale"
      ) as HTMLTextAreaElement[];
      expect(fields.at(-1)?.value).toBe("Version corrigée ailleurs");
    });
  });
});

describe("VoiceNoteBlockView, attente d'un traitement", () => {
  it("attend sur l'état du serveur, pas sur l'apparition d'un contenu", async () => {
    // Un traitement engagé côté serveur mais sans sortie : c'est exactement le
    // cas où le bloc tournait indéfiniment, la fin d'attente étant conditionnée
    // à l'apparition d'un texte qui n'arrivait jamais.
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          transcript: "Texte",
          summary: null,
          processingKind: "summary",
        })
      )
    );
    renderBlock();
    await waitFor(() => expect(screen.getByText("Synthèse en cours")).toBeTruthy());
    expect(screen.getByText(/le traitement continue/)).toBeTruthy();
  });

  it("reprend l'attente au montage : elle survit à la fermeture du document", async () => {
    // Rien n'a été cliqué dans cette page : l'attente vient de la note relue.
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          transcript: "Texte",
          processingKind: "cleanup",
        })
      )
    );
    renderBlock();
    await waitFor(() =>
      expect(screen.getByText("Mise au propre en cours")).toBeTruthy()
    );
  });

  it("sort de l'attente quand le serveur la déclare terminée, même sans texte", async () => {
    const working = makeState({
      status: "validated",
      transcript: "Texte",
      summary: null,
      processingKind: "summary",
    });
    const failed = makeState({
      status: "validated",
      transcript: "Texte",
      summary: null,
      processingKind: null,
      errorCode: "ai_empty_token_limit",
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(working));
    fetchMock.mockResolvedValue(jsonResponse(failed));

    vi.useFakeTimers();
    try {
      renderBlock();
      await tick(0);
      expect(screen.getByText("Synthèse en cours")).toBeTruthy();
      // Une interrogation périodique plus tard, le serveur a rendu son verdict.
      await tick(3500);
      expect(screen.queryByText("Synthèse en cours")).toBeNull();
      expect(screen.getByText("Transcript validé")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VoiceNoteBlockView, traitement sans texte produit", () => {
  const emptyOutputState = (errorCode: string) =>
    jsonResponse(
      makeState({
        status: "validated",
        transcript: "Texte",
        summary: null,
        processingKind: null,
        errorCode,
      })
    );

  it("oriente vers le réglage du modèle quand le budget de jetons est épuisé", async () => {
    fetchMock.mockResolvedValue(emptyOutputState("ai_empty_token_limit"));
    renderBlock();
    expect(
      await screen.findByText(/atteint sa limite de longueur sans rien rendre/)
    ).toBeTruthy();
    // Sans droits d'administration, on ne renvoie pas vers une page interdite.
    expect(
      screen.getByText(/Demandez à un administrateur d'en régler un autre/)
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Administration, IA/ })).toBeNull();
  });

  it("donne à un administrateur le chemin du réglage", async () => {
    currentUser.value = { globalRole: "admin" };
    fetchMock.mockResolvedValue(emptyOutputState("ai_empty_token_limit"));
    renderBlock();
    const link = await screen.findByRole("link", { name: /Administration, IA/ });
    expect(link.getAttribute("href")).toBe("/admin/ai/providers");
  });

  it("propose d'abord la relance quand rien n'a été produit sans plafond atteint", async () => {
    fetchMock.mockResolvedValue(emptyOutputState("ai_empty_output"));
    renderBlock();
    expect(
      await screen.findByText(/terminé sans produire de texte/)
    ).toBeTruthy();
  });

  it("n'affiche pas l'échec de la tentative précédente pendant la relance", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          transcript: "Texte",
          processingKind: "summary",
          errorCode: "ai_empty_token_limit",
        })
      )
    );
    renderBlock();
    await waitFor(() => expect(screen.getByText("Synthèse en cours")).toBeTruthy());
    expect(screen.queryByText(/atteint sa limite de longueur/)).toBeNull();
  });
});

describe("VoiceNoteBlockView, liaison interrompue", () => {
  it("signale une interrogation périodique en échec plutôt que de figer le bloc", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeState({ status: "transcribing" }))
    );
    fetchMock.mockRejectedValue(new Error("réseau injoignable"));

    vi.useFakeTimers();
    try {
      renderBlock();
      await tick(0);
      expect(screen.queryByText(/liaison avec le serveur/)).toBeNull();
      await tick(3500);
      expect(screen.getByText(/La liaison avec le serveur est interrompue/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("efface l'avertissement dès que la liaison est rétablie", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeState({ status: "transcribing" }))
    );
    fetchMock.mockRejectedValueOnce(new Error("réseau injoignable"));
    fetchMock.mockResolvedValue(jsonResponse(makeState({ status: "transcribing" })));

    vi.useFakeTimers();
    try {
      renderBlock();
      await tick(0);
      await tick(3500);
      expect(screen.getByText(/La liaison avec le serveur est interrompue/)).toBeTruthy();
      await tick(3500);
      expect(screen.queryByText(/La liaison avec le serveur est interrompue/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VoiceNoteBlockView, compte rendu produit", () => {
  it("range la synthèse en premier, le transcript en dernier, tout replié", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          durationSeconds: 161,
          transcript: "Texte du transcript",
          summary: "Trois sujets avant la démo.",
          cleanedText: null,
        })
      )
    );
    renderBlock();
    await waitFor(() => expect(screen.getByText("Synthèse et actions")).toBeTruthy());

    const headers = screen
      .getAllByRole("button", { expanded: false })
      .map((element) => element.textContent ?? "");
    const titles = headers.filter((text) =>
      /Synthèse et actions|Texte remis au propre|Transcript/.test(text)
    );
    expect(titles[0]).toContain("Synthèse et actions");
    expect(titles[1]).toContain("Texte remis au propre");
    expect(titles[2]).toContain("Transcript");
    // Aucun identifiant technique n'est affiché.
    expect(screen.queryByText(/note-1/)).toBeNull();
  });

  it("signale un compte rendu antérieur à la dernière correction", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          transcript: "Texte corrigé",
          summary: "Ancienne synthèse",
          transcriptHash: "bbbb",
          summaryTranscriptHash: "aaaa",
        })
      )
    );
    renderBlock();
    const header = await screen.findByRole("button", { name: /Synthèse et actions/ });
    fireEvent.click(header);
    expect(
      await screen.findByText(/Le transcript a été corrigé après ce traitement/)
    ).toBeTruthy();
  });
});

describe("VoiceNoteBlockView, états d'échec", () => {
  it("conserve l'audio et propose la relance après un échec", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({ status: "failed", durationSeconds: 161, hasAudio: true })
      )
    );
    renderBlock();
    await waitFor(() =>
      expect(screen.getByText("La transcription n'a pas abouti")).toBeTruthy()
    );
    expect(screen.getByText(/2 min 41 s est conservé/)).toBeTruthy();
    // Rendu en lien de téléchargement, mais exposé comme bouton par Base UI.
    const download = screen.getByRole("button", { name: /Télécharger l'audio/ });
    expect(download.getAttribute("href")).toBe("/api/voice-notes/note-1/audio");

    fireEvent.click(screen.getByRole("button", { name: /Relancer la transcription/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/retry"))
      ).toBe(true)
    );
  });

  it("n'offre ni téléchargement ni relance quand l'audio n'existe plus", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "failed",
          durationSeconds: 161,
          hasAudio: false,
          errorCode: "audio_missing",
        })
      )
    );
    renderBlock();
    await waitFor(() =>
      expect(screen.getByText("La transcription n'a pas abouti")).toBeTruthy()
    );
    // Le bouton mènerait à une erreur : il ne doit pas être proposé.
    expect(screen.queryByRole("button", { name: /Télécharger l'audio/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Relancer la transcription/ })
    ).toBeNull();
    expect(screen.getByText(/n'est plus disponible/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Enregistrer à nouveau/ })).toBeTruthy();
  });

  it("explique une transcription interrompue plutôt qu'un service muet", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "failed",
          hasAudio: true,
          errorCode: "transcription_stalled",
        })
      )
    );
    renderBlock();
    await waitFor(() =>
      expect(screen.getByText(/interrompue avant d'aboutir/)).toBeTruthy()
    );
    // Rendu en lien de téléchargement, mais exposé comme bouton par Base UI.
    const download = screen.getByRole("button", { name: /Télécharger l'audio/ });
    expect(download.getAttribute("href")).toBe("/api/voice-notes/note-1/audio");
  });

  it("annonce ce qui est accepté quand un fichier est refusé", async () => {
    renderBlock();
    await waitFor(() => expect(screen.getByText(/Déposez un fichier audio ici/)).toBeTruthy());

    const zone = screen.getByText(/Déposez un fichier audio ici/).closest("div");
    const file = new File(["x"], "reunion.txt", { type: "text/plain" });
    fireEvent.drop(zone as HTMLElement, { dataTransfer: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByText("Ce fichier ne peut pas être transcrit")).toBeTruthy()
    );
    expect(
      screen.getByText(/Formats acceptés : mp3, m4a, ogg, wav, webm/)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Choisir un autre fichier/ })).toBeTruthy();
  });

  it("garde le dépôt de fichier ouvert quand le micro est refusé", async () => {
    recorder.status = "denied";
    renderBlock();
    await waitFor(() => expect(screen.getByText("Micro indisponible")).toBeTruthy());
    const zone = screen.getByText(/Vous pouvez aussi/);
    expect(
      within(zone.closest("div") as HTMLElement).getByRole("button", {
        name: /déposer un fichier audio/,
      })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});

describe("VoiceNoteBlockView, conversion des actions en tâches", () => {
  it("n'affiche pas le bouton de conversion sans synthèse", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          transcript: "Texte",
          summary: null,
        })
      )
    );
    renderBlock();
    await waitFor(() => expect(screen.getByText("Transcript validé")).toBeTruthy());
    expect(
      screen.queryByRole("button", { name: /Convertir en tâches/ })
    ).toBeNull();
  });

  it("n'affiche pas le bouton quand la synthèse ne liste aucune action", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          transcript: "Texte",
          summary: "## Résumé\nRien de notable.\n\n## Actions\n(Aucune)",
        })
      )
    );
    renderBlock();
    const header = await screen.findByRole("button", { name: /Synthèse et actions/ });
    fireEvent.click(header);
    expect(
      screen.queryByRole("button", { name: /Convertir en tâches/ })
    ).toBeNull();
  });

  it("affiche le bouton quand la synthèse liste des actions, et ouvre la revue", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          transcript: "Texte",
          summary:
            "## Résumé\nPoint d'avancement.\n\n## Actions\n- Relancer le fournisseur\n- Préparer le budget",
        })
      )
    );
    renderBlock();
    const header = await screen.findByRole("button", { name: /Synthèse et actions/ });
    fireEvent.click(header);
    const button = await screen.findByRole("button", { name: /Convertir en tâches/ });
    fireEvent.click(button);

    expect(await screen.findByText("Convertir les actions en tâches")).toBeTruthy();
    expect(screen.getByDisplayValue("Relancer le fournisseur")).toBeTruthy();
    expect(screen.getByDisplayValue("Préparer le budget")).toBeTruthy();
  });

  it("n'affiche pas le bouton quand l'éditeur n'est pas modifiable", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeState({
          status: "validated",
          transcript: "Texte",
          summary: "## Actions\n- Relancer le fournisseur",
        })
      )
    );
    const updateAttributes = vi.fn();
    const props = {
      node: { attrs: { voiceNoteId: "note-1" } },
      updateAttributes,
      deleteNode: vi.fn(),
      selected: false,
      editor: { isEditable: false },
    } as unknown as NodeViewProps;
    render(<VoiceNoteBlockView {...props} />);
    const header = await screen.findByRole("button", { name: /Synthèse et actions/ });
    fireEvent.click(header);
    expect(
      screen.queryByRole("button", { name: /Convertir en tâches/ })
    ).toBeNull();
  });
});

describe("VoiceNoteBlockView, enregistrement en cours", () => {
  it("affiche la durée et les commandes de pause et de fin", async () => {
    recorder.isRecording = true;
    recorder.status = "recording";
    recorder.durationSeconds = 134;
    renderBlock();
    await waitFor(() => expect(screen.getByText("Enregistrement")).toBeTruthy());
    expect(screen.getByText("02:14")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Terminer" })).toBeTruthy();
  });
});
