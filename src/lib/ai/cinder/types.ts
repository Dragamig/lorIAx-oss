import type { UIMessage } from "ai";

export type CinderScope = "full" | "help-alias";

export type CinderBody = { messages: UIMessage[]; context: string };
