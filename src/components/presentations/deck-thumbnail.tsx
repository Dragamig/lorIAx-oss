"use client";

/**
 * Aperçu de la première diapositive, dessiné à partir du document.
 *
 * Le moteur n'est PAS chargé pour cela : le bloc de l'éditeur doit rester
 * gratuit tant qu'on ne l'ouvre pas, sans quoi un document qui porte plusieurs
 * présentations chargerait plusieurs fois sept cents kilooctets. On redessine
 * donc ce que l'on sait redessiner, fond, images, formes rectangulaires et
 * texte, à l'échelle exacte du document.
 *
 * Deux pièges du format, découverts sur une présentation réelle dont l'aperçu
 * sortait blanc :
 *
 * · le fond visuel d'une diapositive est souvent une IMAGE posée plein cadre,
 *   pas le champ `background` ; les images vivent dans `deck.assets`, indexées
 *   par le préfixe `asset:` que porte leur `src`, en data URI déjà chargée avec
 *   le document (les dessiner ne coûte donc aucune requête) ;
 * · le fond peut aussi RENVOYER au thème par `themeRefs.background` (jeton
 *   `bg1`/`tx2`…) pendant que `background` garde sa valeur d'origine. Le jeton
 *   fait foi, sans quoi la diapositive s'affiche dans l'ancienne couleur.
 *
 * Cela reste une approximation assumée : ni graphiques, ni texte enrichi. Le
 * rendu fidèle est celui du moteur, à l'ouverture.
 */

import type { Deck } from "@/lib/presentations/deck";

interface SlideElement {
  type?: string;
  src?: string;
  fit?: string;
  opacity?: number;
  themeRefs?: Record<string, string>;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  html?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  align?: string;
  fill?: string;
  radius?: number;
}

interface FirstSlide {
  background?: string;
  themeRefs?: Record<string, string>;
  elements?: SlideElement[];
}

interface DeckTheme {
  background?: string;
  color?: string;
  accent?: string;
  palette?: Record<string, string>;
}

/**
 * Résolution d'un jeton de thème. Les paires sont inversées, `bg2` est la
 * couleur de texte et `tx2` la couleur de fond : c'est ainsi que le moteur
 * construit ses pastilles, vérifié sur son propre nuancier.
 */
function themeColor(token: string, theme: DeckTheme | undefined): string | undefined {
  const background = theme?.background;
  const color = theme?.color;
  const accent = theme?.accent;
  switch (token) {
    case "bg1":
      return background;
    case "tx1":
      return color;
    case "bg2":
      return color;
    case "tx2":
      return background;
    default:
      if (token.startsWith("accent")) return theme?.palette?.[token] ?? accent;
      return theme?.palette?.[token];
  }
}

/** Texte brut d'un contenu rédigé : les balises ne sont jamais interprétées. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function DeckThumbnail({
  deck,
  className,
}: {
  deck: Deck;
  className?: string;
}) {
  const size = (deck as { size?: { width?: number; height?: number } }).size;
  const width = size?.width ?? 1280;
  const height = size?.height ?? 720;

  const slide = deck.slides[0] as FirstSlide | undefined;
  const theme = (deck as { theme?: DeckTheme }).theme;
  const assets = (deck as { assets?: Record<string, string> }).assets ?? {};
  const backgroundToken = slide?.themeRefs?.background;
  const background =
    (backgroundToken ? themeColor(backgroundToken, theme) : undefined) ??
    slide?.background ??
    theme?.background ??
    "#FFFFFF";
  const defaultColor = theme?.color ?? "#1E2A3A";

  const elements = (slide?.elements ?? []).slice(0, 12);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={width} height={height} fill={background} />

      {elements.map((element, index) => {
        const x = Number(element.x) || 0;
        const y = Number(element.y) || 0;
        const w = Number(element.w) || 0;
        const h = Number(element.h) || 0;

        if (element.type === "image" && element.src) {
          const source = element.src.startsWith("asset:")
            ? assets[element.src.slice("asset:".length)]
            : element.src;
          if (!source) return null;
          return (
            <image
              key={index}
              href={source}
              x={x}
              y={y}
              width={w}
              height={h}
              opacity={element.opacity ?? 1}
              preserveAspectRatio={
                element.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"
              }
            />
          );
        }

        if (element.type === "shape" && element.fill) {
          return (
            <rect
              key={index}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={Number(element.radius) || 0}
              fill={element.fill}
            />
          );
        }

        if (element.type !== "text" || !element.html) return null;
        const text = plainText(element.html);
        if (!text) return null;

        const fontSize = Number(element.fontSize) || 32;
        const anchor =
          element.align === "center"
            ? "middle"
            : element.align === "right"
              ? "end"
              : "start";
        const anchorX =
          anchor === "middle" ? x + w / 2 : anchor === "end" ? x + w : x;

        return (
          <text
            key={index}
            x={anchorX}
            y={y + fontSize}
            fill={
              (element.themeRefs?.color
                ? themeColor(element.themeRefs.color, theme)
                : undefined) ??
              element.color ??
              defaultColor
            }
            fontSize={fontSize}
            fontWeight={element.fontWeight ?? 400}
            textAnchor={anchor}
            fontFamily="system-ui, sans-serif"
          >
            {text.length > 60 ? `${text.slice(0, 60)}...` : text}
          </text>
        );
      })}
    </svg>
  );
}
