// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAudioRecorder } from "./use-audio-recorder";

/**
 * jsdom ne fournit ni MediaRecorder ni AudioContext : on installe des doubles
 * minimaux, juste assez pour verifier le cycle de vie et, surtout, que le flux
 * micro est bien relache (pastille d'enregistrement du navigateur).
 */

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks: FakeTrack[];
  constructor() {
    this.tracks = [new FakeTrack()];
  }
  getTracks() {
    return this.tracks;
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";

  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  /** L'arret leve, comme un recorder deja tombe cote navigateur. */
  stopThrows = false;
  /** L'arret n'emet jamais `onstop` : le cas qui laissait le micro allume. */
  silentStop = false;

  constructor(
    public stream: unknown,
    options?: { mimeType?: string }
  ) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    if (this.stopThrows) throw new Error("recorder deja tombe");
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["son"], { type: this.mimeType }) });
    if (!this.silentStop) this.onstop?.();
  }
}

let lastStream: FakeStream | null = null;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  lastStream = null;
  getUserMedia = vi.fn(async () => {
    lastStream = new FakeStream();
    return lastStream as unknown as MediaStream;
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  // Pas d'AudioContext : le hook doit rester fonctionnel sans jauge de niveau.
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAudioRecorder", () => {
  it("part au repos", () => {
    const { result } = renderHook(() => useAudioRecorder());
    expect(result.current.status).toBe("idle");
    expect(result.current.durationSeconds).toBe(0);
    expect(result.current.isRecording).toBe(false);
  });

  it("passe en enregistrement puis en pause et reprend", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("recording");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });

    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    expect(result.current.isPaused).toBe(true);

    act(() => result.current.resume());
    expect(result.current.status).toBe("recording");
  });

  it("rend l'enregistrement et relache le micro a l'arret", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    const stream = lastStream;
    expect(stream?.getTracks()[0].stopped).toBe(false);

    let recording: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      recording = await result.current.stop();
    });

    expect(recording).not.toBeNull();
    expect(recording!.blob.size).toBeGreaterThan(0);
    expect(result.current.status).toBe("stopped");
    // La pastille d'enregistrement du navigateur doit s'eteindre.
    expect(stream?.getTracks()[0].stopped).toBe(true);
  });

  it("relache le micro meme si l'arret du recorder leve", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    const stream = lastStream;
    FakeMediaRecorder.instances[0].stopThrows = true;

    let recording: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      recording = await result.current.stop();
    });

    // L'arret a echoue : rien a rendre, mais la pastille doit s'eteindre.
    expect(recording).toBeNull();
    expect(result.current.status).toBe("stopped");
    expect(stream?.getTracks()[0].stopped).toBe(true);
  });

  it("relache le micro meme si l'evenement d'arret ne vient jamais", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    const stream = lastStream;
    FakeMediaRecorder.instances[0].silentStop = true;

    vi.useFakeTimers();
    try {
      let settled = false;
      let pending: Promise<unknown> = Promise.resolve();
      act(() => {
        pending = result.current.stop().then((value) => {
          settled = true;
          return value;
        });
      });
      expect(settled).toBe(false);

      // Le delai de garde prend le relais de `onstop`.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    expect(stream?.getTracks()[0].stopped).toBe(true);
    expect(result.current.status).toBe("stopped");
  });

  it("relache le micro au demontage, meme en pleine capture", async () => {
    const { result, unmount } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    const stream = lastStream;
    expect(stream?.getTracks()[0].stopped).toBe(false);

    unmount();

    expect(stream?.getTracks()[0].stopped).toBe(true);
    expect(FakeMediaRecorder.instances[0].state).toBe("inactive");
  });

  it("signale un micro refuse sans laisser de flux ouvert", async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error("refus"), { name: "NotAllowedError" })
    );
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.error).toBeTruthy();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("declare le navigateur inapte quand MediaRecorder manque", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("unsupported");
  });

  it("choisit un format supporte par le navigateur", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.start();
    });
    expect(FakeMediaRecorder.instances[0].mimeType).toBe("audio/webm;codecs=opus");
  });
});
