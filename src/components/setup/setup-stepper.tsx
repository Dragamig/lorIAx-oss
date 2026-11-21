"use client";

const STEP_IDS = [
  "welcome",
  "identity",
  "context",
  "users",
  "spaces",
  "permissions",
  "summary",
] as const;

export type SetupStep = (typeof STEP_IDS)[number];

interface SetupStepperProps {
  currentStep: SetupStep;
}

export function SetupStepper({ currentStep }: SetupStepperProps) {
  const currentIndex = STEP_IDS.findIndex((id) => id === currentStep);

  return (
    <div className="flex items-center gap-2 mb-8">
      {STEP_IDS.map((id, i) => (
        <div key={id} className="flex items-center gap-2">
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
              i < currentIndex
                ? "bg-primary text-primary-foreground"
                : i === currentIndex
                  ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {i < currentIndex ? "✓" : i + 1}
          </div>
          {i < STEP_IDS.length - 1 && (
            <div className={`h-0.5 w-8 ${i < currentIndex ? "bg-primary" : "bg-muted"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
