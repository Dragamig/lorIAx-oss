/**
 * AZ-09 : le canal WebSocket de collaboration ouvrait toute connexion en
 * ECRITURE.
 *
 * `onAuthenticate` autorisait sur le seul droit de lecture et ne posait jamais
 * `readOnly`, que Hocuspocus laisse a `false` par defaut. Un membre d'espace au
 * niveau `viewer` pouvait donc ouvrir le WebSocket avec un client Yjs et
 * pousser des mises a jour : elles etaient appliquees au document partage et
 * diffusees en direct aux editeurs connectes, puis persistees des qu'un
 * editeur legitime declenchait une ecriture. Le `editable=false` du composant
 * editeur est purement client, donc sans valeur.
 *
 * Le crochet verifie desormais le droit d'ecriture
 * (`checkCollabDocumentEditAccess`) et pose `connectionConfig.readOnly = true`
 * quand il n'est pas accorde, sans refuser la connexion : le lecteur doit
 * continuer a lire en temps reel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";

// Le module d'acces WS importe le client Postgres au chargement : on le
// remplace par un objet inerte, aucun test ici ne touche la base.
vi.mock("@/lib/db", () => ({ db: {} }));

const verifyWsToken = vi.hoisted(() => vi.fn());
const checkDocumentAccess = vi.hoisted(() => vi.fn());
const checkCollabDocumentEditAccess = vi.hoisted(() => vi.fn());

// Doublure partielle : on ne pilote que les trois controles d'autorisation,
// tout le reste du module reste le module reel (importOriginal).
vi.mock("@/lib/collab/auth-ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/collab/auth-ws")>();
  return {
    ...actual,
    verifyWsToken,
    checkDocumentAccess,
    checkCollabDocumentEditAccess,
  };
});

import { createHocuspocusServer } from "@/lib/collab/hocuspocus-config";
import { Connection, Document } from "@hocuspocus/server";

const DOC_ID = "11111111-2222-4333-8444-555555555555";

type ConnectionConfig = { readOnly: boolean; isAuthenticated: boolean };

/** Recupere le crochet `onAuthenticate` reellement cable dans le serveur. */
function getOnAuthenticate() {
  const server = createHocuspocusServer();
  const hook = server.configuration.onAuthenticate;
  if (!hook) throw new Error("onAuthenticate non configure");
  return hook.bind(server.configuration);
}

/** Payload minimal du crochet, avec la configuration de connexion par defaut. */
function payload(connectionConfig: ConnectionConfig, documentName = DOC_ID) {
  return {
    token: "jeton",
    documentName,
    connectionConfig,
    // Champs presents dans le payload Hocuspocus mais inutilises par le crochet
    context: {},
    instance: undefined,
    requestHeaders: {},
    requestParameters: new URLSearchParams(),
    request: undefined,
    socketId: "socket-1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const freshConfig = (): ConnectionConfig => ({ readOnly: false, isAuthenticated: false });

const wsUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "user@org-a.test",
  name: "Utilisateur",
  globalRole: "editor",
  avatarUrl: null,
  orgId: "org-a",
  ...overrides,
});

beforeEach(() => {
  verifyWsToken.mockReset();
  checkDocumentAccess.mockReset();
  checkCollabDocumentEditAccess.mockReset();
});

describe("onAuthenticate — lecture seule pour qui n'a pas le droit d'ecrire", () => {
  it("ouvre une connexion en LECTURE SEULE (et non un refus) pour un membre au niveau viewer", async () => {
    verifyWsToken.mockResolvedValue(wsUser());
    checkDocumentAccess.mockResolvedValue(true);
    checkCollabDocumentEditAccess.mockResolvedValue(false);

    const config = freshConfig();
    const result = await getOnAuthenticate()(payload(config));

    // La connexion aboutit : le lecteur continue de lire en temps reel.
    expect(result).toMatchObject({ user: { id: "user-1", orgId: "org-a" } });
    // Mais elle est bridee en lecture seule.
    expect(config.readOnly).toBe(true);
  });

  it("ouvre une connexion en ECRITURE pour un editeur legitime", async () => {
    verifyWsToken.mockResolvedValue(wsUser());
    checkDocumentAccess.mockResolvedValue(true);
    checkCollabDocumentEditAccess.mockResolvedValue(true);

    const config = freshConfig();
    const result = await getOnAuthenticate()(payload(config));

    expect(result).toMatchObject({ user: { id: "user-1" } });
    expect(config.readOnly).toBe(false);
  });

  it("interroge le droit d'ecriture avec l'organisation portee par le jeton", async () => {
    verifyWsToken.mockResolvedValue(wsUser());
    checkDocumentAccess.mockResolvedValue(true);
    checkCollabDocumentEditAccess.mockResolvedValue(false);

    await getOnAuthenticate()(payload(freshConfig()));

    expect(checkCollabDocumentEditAccess).toHaveBeenCalledWith("user-1", DOC_ID, "org-a");
  });

  it("refuse la connexion si la configuration de connexion est absente et l'ecriture non accordee", async () => {
    verifyWsToken.mockResolvedValue(wsUser());
    checkDocumentAccess.mockResolvedValue(true);
    checkCollabDocumentEditAccess.mockResolvedValue(false);

    const data = payload(freshConfig());
    delete data.connectionConfig;

    await expect(getOnAuthenticate()(data)).rejects.toThrow("Accès refusé");
  });
});

describe("onAuthenticate — refus (proprietes deja acquises)", () => {
  it("refuse un utilisateur sans aucun droit sur le document", async () => {
    verifyWsToken.mockResolvedValue(wsUser({ id: "intrus" }));
    checkDocumentAccess.mockResolvedValue(false);

    await expect(getOnAuthenticate()(payload(freshConfig()))).rejects.toThrow("Accès refusé");
    // On ne demande meme pas le droit d'ecriture : la lecture a deja echoue.
    expect(checkCollabDocumentEditAccess).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur d'une autre organisation", async () => {
    // Le cloisonnement est porte par checkDocumentAccess, qui recoit l'org du
    // jeton : un document hors de cette org renvoie false (cf. auth-ws).
    verifyWsToken.mockResolvedValue(wsUser({ id: "user-org-b", orgId: "org-b" }));
    checkDocumentAccess.mockResolvedValue(false);

    await expect(getOnAuthenticate()(payload(freshConfig()))).rejects.toThrow("Accès refusé");
    expect(checkDocumentAccess).toHaveBeenCalledWith("user-org-b", DOC_ID, "editor", "org-b");
  });

  it("refuse un jeton depourvu d'organisation", async () => {
    verifyWsToken.mockResolvedValue(wsUser({ orgId: null }));

    await expect(getOnAuthenticate()(payload(freshConfig()))).rejects.toThrow("Session expirée");
  });

  it("refuse un identifiant de document qui n'est pas un UUID", async () => {
    await expect(
      getOnAuthenticate()(payload(freshConfig(), "../../etc/passwd"))
    ).rejects.toThrow("Identifiant de document invalide");
    expect(verifyWsToken).not.toHaveBeenCalled();
  });
});

/**
 * Preuve de la propriete qui compte vraiment : une mise a jour Yjs poussee par
 * une connexion en lecture seule n'atteint pas le document partage.
 *
 * Ces cas rejouent le chemin REEL de la bibliotheque (Connection.handleMessage
 * → MessageReceiver) avec un document reel et un faux WebSocket. Point clef,
 * corrige apres la revue du lot 6 : le drapeau `readOnly` passe a la connexion
 * n'est plus ecrit en dur, il est celui que le crochet `onAuthenticate` a
 * REELLEMENT pose. Le correctif AZ-09 est donc dans le chemin exerce, et non a
 * cote : neutraliser sa ligne centrale fait tomber tout ce bloc, et pas un
 * unique test d'egalite sur un booleen.
 */
describe("propagation — une update poussee par un lecteur n'atteint pas le Y.Doc partage", () => {
  const MESSAGE_TYPE_SYNC = 0;
  const SYNC_STEP_2 = 1;
  const SYNC_UPDATE = 2;

  /** Encode le message qu'un client Yjs enverrait pour pousser une update. */
  function encodeUpdateMessage(
    documentName: string,
    update: Uint8Array,
    syncType: number = SYNC_UPDATE
  ) {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, documentName);
    encoding.writeVarUint(encoder, MESSAGE_TYPE_SYNC);
    encoding.writeVarUint(encoder, syncType);
    encoding.writeVarUint8Array(encoder, update);
    return encoding.toUint8Array(encoder);
  }

  /** Update produite par un client qui ecrit du texte dans le document. */
  function vandalismUpdate(text: string) {
    const client = new Y.Doc();
    client.getText("content").insert(0, text);
    return Y.encodeStateAsUpdate(client);
  }

  /**
   * Update touchant plusieurs types partages a la fois : l'editeur reel ecrit
   * dans un fragment XML et dans des metadonnees, pas seulement dans un texte.
   */
  function vandalismUpdateMultiType() {
    const client = new Y.Doc();
    client.getText("content").insert(0, "corps pirate");
    client.getMap("meta").set("titre", "titre pirate");
    client.getArray("commentaires").push(["commentaire pirate"]);
    const fragment = client.getXmlFragment("default");
    fragment.insert(0, [new Y.XmlText("paragraphe pirate")]);
    return Y.encodeStateAsUpdate(client);
  }

  function openConnection(readOnly: boolean) {
    const document = new Document(DOC_ID);
    const socket = {
      binaryType: "nodebuffer",
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const connection = new Connection(
      socket,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { headers: {}, url: "/ws/collab" } as any,
      document,
      "socket-1",
      {},
      readOnly
    );
    return { document, connection };
  }

  /**
   * Ouvre une connexion dont le drapeau `readOnly` sort du crochet reel.
   * `canEdit` est la seule chose pilotee : le reste du chemin est le code de
   * production.
   */
  async function connexionAutorisee(canEdit: boolean) {
    verifyWsToken.mockResolvedValue(wsUser());
    checkDocumentAccess.mockResolvedValue(true);
    checkCollabDocumentEditAccess.mockResolvedValue(canEdit);

    const config = freshConfig();
    await getOnAuthenticate()(payload(config));
    return openConnection(config.readOnly);
  }

  /** Laisse le tour de boucle a MessageReceiver, qui traite en asynchrone. */
  const laisserPasser = () => new Promise((resolve) => setImmediate(resolve));

  it("laisse le document partage intact quand le lecteur pousse une update", async () => {
    const { document, connection } = await connexionAutorisee(false);

    connection.handleMessage(encodeUpdateMessage(DOC_ID, vandalismUpdate("VANDALISME")));
    await laisserPasser();

    expect(document.getText("content").toString()).toBe("");
  });

  it("applique bien l'update quand la connexion est en ecriture (temoin)", async () => {
    const { document, connection } = await connexionAutorisee(true);

    connection.handleMessage(encodeUpdateMessage(DOC_ID, vandalismUpdate("texte legitime")));
    await laisserPasser();

    expect(document.getText("content").toString()).toBe("texte legitime");
  });

  it("resiste aussi a la forme `syncStep2`, qui transporte le meme etat", async () => {
    const lecteur = await connexionAutorisee(false);
    lecteur.connection.handleMessage(
      encodeUpdateMessage(DOC_ID, vandalismUpdate("VANDALISME"), SYNC_STEP_2)
    );
    await laisserPasser();
    expect(lecteur.document.getText("content").toString()).toBe("");

    // Temoin : la meme forme de message passe pour un editeur, donc le refus
    // vient bien du droit d'ecriture et non d'un message mal encode.
    const editeur = await connexionAutorisee(true);
    editeur.connection.handleMessage(
      encodeUpdateMessage(DOC_ID, vandalismUpdate("texte legitime"), SYNC_STEP_2)
    );
    await laisserPasser();
    expect(editeur.document.getText("content").toString()).toBe("texte legitime");
  });

  it("protege tous les types partages, pas seulement le texte", async () => {
    const { document, connection } = await connexionAutorisee(false);

    connection.handleMessage(encodeUpdateMessage(DOC_ID, vandalismUpdateMultiType()));
    await laisserPasser();

    expect(document.getText("content").toString()).toBe("");
    expect(document.getMap("meta").size).toBe(0);
    expect(document.getArray("commentaires").length).toBe(0);
    expect(document.getXmlFragment("default").length).toBe(0);
  });

  it("resiste a une rafale de messages, y compris apres coup", async () => {
    const { document, connection } = await connexionAutorisee(false);

    for (let i = 0; i < 5; i++) {
      connection.handleMessage(encodeUpdateMessage(DOC_ID, vandalismUpdate(`essai ${i}`)));
      connection.handleMessage(
        encodeUpdateMessage(DOC_ID, vandalismUpdate(`essai ${i}`), SYNC_STEP_2)
      );
    }
    await laisserPasser();

    expect(document.getText("content").toString()).toBe("");
  });

  it("n'ecrase pas le travail d'un editeur deja en place", async () => {
    const editeur = await connexionAutorisee(true);
    editeur.connection.handleMessage(
      encodeUpdateMessage(DOC_ID, vandalismUpdate("texte legitime"))
    );
    await laisserPasser();

    // Un lecteur ouvre une connexion sur LE MEME document et pousse sa version.
    const config = freshConfig();
    checkCollabDocumentEditAccess.mockResolvedValue(false);
    await getOnAuthenticate()(payload(config));
    const lecteur = new Connection(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { binaryType: "nodebuffer", readyState: 1, send: vi.fn(), close: vi.fn() } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { headers: {}, url: "/ws/collab" } as any,
      editeur.document,
      "socket-2",
      {},
      config.readOnly
    );
    lecteur.handleMessage(encodeUpdateMessage(DOC_ID, vandalismUpdate("VANDALISME")));
    await laisserPasser();

    expect(editeur.document.getText("content").toString()).toBe("texte legitime");
  });

  /**
   * PERSISTANCE. Hocuspocus n'ecrit en base que sur evenement `update` du
   * document partage (crochets `onChange` / `onStoreDocument`). Aucun evenement
   * emis, donc rien de diffuse aux editeurs connectes et rien de persiste des
   * qu'un editeur legitime declenche une ecriture, ce qui etait le scenario
   * exact d'AZ-09.
   */
  it("n'emet AUCUN evenement de mise a jour, donc rien n'est diffuse ni persiste", async () => {
    const { document, connection } = await connexionAutorisee(false);
    const surUpdate = vi.fn();
    document.on("update", surUpdate);

    connection.handleMessage(encodeUpdateMessage(DOC_ID, vandalismUpdate("VANDALISME")));
    await laisserPasser();

    expect(surUpdate).not.toHaveBeenCalled();
  });

  it("emet bien cet evenement pour un editeur (temoin de la persistance)", async () => {
    const { document, connection } = await connexionAutorisee(true);
    const surUpdate = vi.fn();
    document.on("update", surUpdate);

    connection.handleMessage(encodeUpdateMessage(DOC_ID, vandalismUpdate("texte legitime")));
    await laisserPasser();

    expect(surUpdate).toHaveBeenCalled();
  });

  /**
   * Le lecteur ne voit pas ses propres modifications appliquees au document
   * partage : ni contenu, ni trace de son identifiant de client dans le vecteur
   * d'etat. Une application locale suivie d'un rejet silencieux laisserait le
   * document dans un etat different de celui d'avant.
   */
  it("ne laisse aucune trace du lecteur dans l'etat partage", async () => {
    const { document, connection } = await connexionAutorisee(false);
    const avant = Y.encodeStateAsUpdate(document);
    const vecteurAvant = Y.encodeStateVector(document);

    connection.handleMessage(encodeUpdateMessage(DOC_ID, vandalismUpdate("VANDALISME")));
    await laisserPasser();

    expect(Array.from(Y.encodeStateVector(document))).toEqual(Array.from(vecteurAvant));
    expect(Array.from(Y.encodeStateAsUpdate(document))).toEqual(Array.from(avant));

    // Et un client qui se synchroniserait maintenant ne recevrait rien du tout.
    const nouveauClient = new Y.Doc();
    Y.applyUpdate(nouveauClient, Y.encodeStateAsUpdate(document));
    expect(nouveauClient.getText("content").toString()).toBe("");
  });
});
