"use client";

import { SessionProvider } from "next-auth/react";
import { AppearanceProvider } from "./appearance-provider";
import { getClientSlots } from "@/lib/modules/hooks.client";
import type { ClientLicense } from "@/lib/modules/hooks";
import { ThemeProvider } from "@/contexts/theme-context";
import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
  licenseData?: ClientLicense | null;
}

export function Providers({ children, licenseData }: ProvidersProps) {
  const { LicenseProvider } = getClientSlots();
  return (
    <ThemeProvider>
      <SessionProvider>
        <LicenseProvider license={licenseData ?? null}>
          <AppearanceProvider>{children}</AppearanceProvider>
        </LicenseProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
