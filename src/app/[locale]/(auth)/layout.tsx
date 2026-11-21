import { AiCredit } from "@/components/layout/ai-credit";

// Rendu dynamique obligatoire : la CSP `strict-dynamic` du proxy exige que
// Next.js injecte le nonce dans les <script>, ce qu'il ne fait qu'au SSR.
// Sans ça, les pages auth sont prérendues statiquement (aucun nonce) et tous
// leurs scripts sont bloqués par le navigateur → chargement infini.
export const dynamic = "force-dynamic";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // a11y : landmark <main> unique pour les pages auth (login/register/...) —
  // les lecteurs d'ecran ont besoin d'un repere de contenu principal.
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="px-4 py-3 text-center text-xs text-muted-foreground">
        <AiCredit />
      </footer>
    </div>
  );
}
