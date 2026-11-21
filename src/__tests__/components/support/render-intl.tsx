import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../messages/fr.json";

/** Render wrapped in the French intl provider with a stubbed matchMedia. */
export function renderWithIntl(ui: React.ReactElement, opts: { narrow?: boolean } = {}) {
  const narrow = opts.narrow ?? false;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: narrow,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  const wrap = (node: React.ReactElement) => (
    <NextIntlClientProvider locale="fr" messages={fr}>
      {node}
    </NextIntlClientProvider>
  );
  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (next: React.ReactElement) => result.rerender(wrap(next)),
  };
}
