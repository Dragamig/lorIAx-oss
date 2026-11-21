import type { Editor, Range } from "@tiptap/core";

export interface CommandItem {
  title: string;
  description: string;
  /** Clé de message complète : remplace `description` à l'affichage. */
  descriptionKey?: string;
  aliases?: string[];
  icon: React.ReactNode;
  command: (props: { editor: Editor; range: Range }) => void;
  desktopOnly?: boolean;
  /** Module fournisseur : la commande disparaît si le module n'est pas actif. */
  module?: string;
}

export interface CommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

export interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}
