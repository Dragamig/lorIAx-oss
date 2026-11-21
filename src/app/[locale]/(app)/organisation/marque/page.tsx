import { BrandKitEditor } from "./brand-kit-editor";

export default function MarquePage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">Identité de marque</h2>
        <p className="text-sm text-muted-foreground">
          Couleurs, logos et polices réutilisables dans le Studio de design par tous les membres.
        </p>
      </div>
      <BrandKitEditor />
    </div>
  );
}
