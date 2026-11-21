"use client";

// loriax-app/src/components/onboarding/hooks/use-onboarding-progress.ts
// Hook SWR pour charger /api/onboarding/progress (refresh 30s).

import useSWR from "swr";
import type { OnboardingProgressRow } from "@/lib/onboarding/types";

interface ProgressResponse {
  progress: OnboardingProgressRow | null;
}

const fetcher = (url: string): Promise<ProgressResponse> =>
  fetch(url).then((r) => r.json());

export function useOnboardingProgress() {
  const { data, mutate, isLoading, error } = useSWR<ProgressResponse>(
    "/api/onboarding/progress",
    fetcher,
    { refreshInterval: 30_000 },
  );
  return {
    progress: data?.progress ?? null,
    mutate,
    isLoading,
    error,
  };
}
