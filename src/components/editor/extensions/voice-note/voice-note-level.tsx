"use client";

const MIN_HEIGHT_PERCENT = 22;
/**
 * Profil fixe des barres : la jauge garde un relief de forme d'onde tout en
 * restant une lecture directe du niveau, sans historique ni état local.
 */
const BAR_WEIGHTS = [
  0.32, 0.62, 0.95, 0.5, 0.78, 0.35, 0.68, 1, 0.42, 0.74, 0.28, 0.86, 0.55, 0.4,
];

interface VoiceNoteLevelProps {
  /** Niveau instantané, entre 0 et 1. */
  level: number;
  /** Gèle l'affichage pendant une pause. */
  frozen?: boolean;
}

/**
 * Niveau sonore de l'enregistrement : il lève le doute permanent du dictaphone,
 * est-ce que ça enregistre vraiment ?
 */
export function VoiceNoteLevel({ level, frozen = false }: VoiceNoteLevelProps) {
  const value = frozen ? 0 : Math.min(1, Math.max(0, level));

  return (
    <div
      className="flex h-7 min-w-[90px] flex-1 items-center gap-[3px]"
      role="meter"
      aria-label="Niveau sonore"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      {BAR_WEIGHTS.map((weight, index) => (
        <span
          key={index}
          className="block w-[3px] rounded-sm bg-destructive/80 transition-[height] duration-100"
          style={{
            height: `${MIN_HEIGHT_PERCENT + value * weight * (100 - MIN_HEIGHT_PERCENT)}%`,
          }}
        />
      ))}
    </div>
  );
}
