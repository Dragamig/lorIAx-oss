// Layout racine minimal — la balise <html> est portée par
// src/app/[locale]/layout.tsx (next-intl App Router pattern).
// Next.js exige un root layout, mais il peut être pass-through quand
// un layout descendant fournit <html>/<body>.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
