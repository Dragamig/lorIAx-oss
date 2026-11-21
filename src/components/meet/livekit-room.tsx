"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  ControlBar,
  RoomAudioRenderer,
  LayoutContextProvider,
  useTracks,
  useLocalParticipant,
  useTrackVolume,
} from "@livekit/components-react";
import { type LocalAudioTrack, Track } from "livekit-client";
import "@livekit/components-styles";
import { EditorBlockErrorBoundary } from "@/components/editor/editor-error-boundary";
import { RecordingOverlay } from "./recording-overlay";
import { MobileConferenceLayout } from "./mobile-conference-layout";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslations } from "next-intl";

function RoomLoader() {
  const t = useTranslations("meet.livekit");
  return (
    <div className="flex h-[600px] items-center justify-center rounded-lg bg-muted/50">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">
          {t("loading")}
        </p>
      </div>
    </div>
  );
}

/**
 * VU meter showing local microphone level.
 * Must be rendered inside a <LiveKitRoom>.
 *
 * Uses microphoneTrack from useLocalParticipant() directly — more stable than
 * calling getTrackPublications().find() and constructing a TrackReference manually.
 * The track is passed as LocalAudioTrack directly to useTrackVolume, which is
 * the cleaner API (avoids the TrackReference wrapper).
 */
function AudioLevelIndicatorInner() {
  const t = useTranslations("meet.livekit");
  const { microphoneTrack } = useLocalParticipant();

  // Cast is safe: microphoneTrack.track is always a LocalAudioTrack (microphone = audio)
  const audioTrack = microphoneTrack?.track as LocalAudioTrack | undefined;

  // Pass the track directly — useTrackVolume accepts LocalAudioTrack | undefined
  const volume = useTrackVolume(audioTrack);

  const isMuted = !audioTrack || microphoneTrack?.isMuted === true;
  const barCount = 8;
  const level = isMuted ? 0 : Math.min(volume ?? 0, 1);

  return (
    <div
      className="absolute bottom-3 left-3 z-50 flex items-end gap-0.5 rounded bg-black/60 px-2 py-1.5"
      title={isMuted ? t("micMuted") : t("micLevel", { level: Math.round(level * 100) })}
    >
      {Array.from({ length: barCount }, (_, i) => {
        const threshold = (i + 1) / barCount;
        const active = level >= threshold;
        return (
          <div
            key={i}
            className="w-1 rounded-sm transition-all duration-75"
            style={{
              height: `${8 + i * 2}px`,
              backgroundColor: active
                ? i < 5 ? "#22c55e" : i < 7 ? "#eab308" : "#ef4444"
                : "rgba(255,255,255,0.2)",
            }}
          />
        );
      })}
      {isMuted && (
        <span className="ml-1.5 text-[10px] text-red-400 font-medium">{t("muted")}</span>
      )}
    </div>
  );
}

/**
 * AudioLevelIndicator wrapped in its own error boundary.
 * If the VU-meter crashes (e.g. AudioContext unavailable, hook version mismatch),
 * the main conference layout is preserved and only the VU-meter silently disappears.
 */
function AudioLevelIndicator() {
  return (
    <EditorBlockErrorBoundary blockType="vu-meter">
      <AudioLevelIndicatorInner />
    </EditorBlockErrorBoundary>
  );
}

/**
 * Custom video conference layout using LiveKit primitives.
 * Avoids the duplicate-key and placeholder-array bugs from <VideoConference />.
 */
function DesktopConferenceLayout() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <LayoutContextProvider>
      <div className="lk-video-conference" data-lk-theme="default" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <GridLayout tracks={tracks}>
            <ParticipantTile />
          </GridLayout>
        </div>
        <ControlBar variation="verbose" />
        <RoomAudioRenderer />
      </div>
    </LayoutContextProvider>
  );
}

function ConferenceLayout({ onDisconnect }: { onDisconnect?: () => void }) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <MobileConferenceLayout onDisconnect={onDisconnect} />;
  }
  return <DesktopConferenceLayout />;
}

interface LiveKitMeetingProps {
  roomName: string;
  userName?: string;
  userEmail?: string;
  meetingId?: string | null;
  onDisconnected?: () => void;
  height?: string;
  audioOnly?: boolean;
  preloadedToken?: string;
  preloadedServerUrl?: string;
}

export function LiveKitMeeting({
  roomName,
  userName: _userName = "",
  userEmail: _userEmail = "",
  meetingId = null,
  onDisconnected,
  height = "600px",
  audioOnly = false,
  preloadedToken,
  preloadedServerUrl,
}: LiveKitMeetingProps) {
  const t = useTranslations("meet.livekit");
  const [token, setToken] = useState<string | null>(preloadedToken ?? null);
  const [serverUrl, setServerUrl] = useState<string | null>(preloadedServerUrl ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If preloaded token and server URL are provided, skip fetching
    if (preloadedToken && preloadedServerUrl) {
      return;
    }

    const configError = t("configError");
    const tokenError = t("tokenError");
    const livekitNotConfigured = t("livekitNotConfigured");

    const configPromise = fetch("/api/meet/config")
      .then((res) => {
        if (!res.ok) throw new Error(configError);
        return res.json();
      })
      .then((data) => data.url as string);

    const tokenPromise = fetch("/api/meet/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName }),
    }).then((res) => {
      if (!res.ok) {
        if (res.status === 503) {
          throw new Error(livekitNotConfigured);
        }
        throw new Error(tokenError);
      }
      return res.json().then((data) => data.token as string);
    });

    Promise.all([configPromise, tokenPromise])
      .then(([url, tkn]) => {
        setServerUrl(url);
        setToken(tkn);
      })
      .catch((err) => setError(err.message));
  }, [roomName, preloadedToken, preloadedServerUrl, t]);

  const handleDisconnected = useCallback(() => {
    onDisconnected?.();
  }, [onDisconnected]);

  if (error) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-lg bg-destructive/10">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return <RoomLoader />;
  }

  return (
    <div style={{ height }} className="relative overflow-hidden rounded-lg">
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect={true}
        video={!audioOnly}
        audio={true}
        onDisconnected={handleDisconnected}
        data-lk-theme="default"
        style={{ height: "100%" }}
      >
        <ConferenceLayout onDisconnect={handleDisconnected} />
        <AudioLevelIndicator />
        {meetingId && (
          <EditorBlockErrorBoundary blockType="recording-overlay">
            <RecordingOverlay meetingId={meetingId} />
          </EditorBlockErrorBoundary>
        )}
      </LiveKitRoom>
    </div>
  );
}
