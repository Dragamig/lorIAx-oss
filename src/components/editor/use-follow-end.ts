"use client";

import { useEffect, useRef } from "react";

/**
 * Distance au bas du conteneur (en px) en deçà de laquelle on considère que
 * l'utilisateur « est en bas » et souhaite donc rester collé au bas.
 * Au-delà, il a volontairement remonté : le suivi se met en veille.
 */
export const FOLLOW_END_THRESHOLD_PX = 80;

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** Fonction pure, testable sans DOM. */
export function isNearBottom(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  threshold: number = FOLLOW_END_THRESHOLD_PX
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/**
 * Garde la vue collée au bas du conteneur quand le contenu grandit.
 *
 * Contrairement au modèle du chat (`help-assistant.tsx`), on ne ramène JAMAIS
 * l'utilisateur de force : s'il remonte, le suivi se met en veille et ne
 * reprend que lorsqu'il redescend sous le seuil. Le défilement est instantané
 * (« auto ») et non « smooth », sinon il lutte contre la frappe.
 *
 * On observe la taille du contenu plutôt que les transactions de l'éditeur :
 * cela couvre d'un coup la frappe, les mises à jour collaboratives, les
 * insertions de l'IA et les images qui finissent de charger.
 *
 * Le conteneur est passé en élément (et non en ref) : l'éditeur ne le monte
 * qu'une fois TipTap prêt, or un effet dépendant d'une ref ne se rejouerait
 * jamais au moment où l'élément apparaît.
 */
export function useFollowEnd(
  container: HTMLElement | null,
  enabled: boolean
) {
  // `true` tant que l'utilisateur n'a pas remonté volontairement.
  const stickRef = useRef(true);

  useEffect(() => {
    if (!container || !enabled) return;
    const el = container;

    // `scrollTop` est un état du navigateur, pas une donnée React : la règle
    // d'immutabilité des arguments de hook ne s'applique pas à un nœud du DOM.
    /* eslint-disable react-hooks/immutability */

    // À l'activation, on descend une première fois et on réarme le suivi.
    stickRef.current = true;
    el.scrollTop = el.scrollHeight;

    const handleScroll = () => {
      stickRef.current = isNearBottom(el);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });

    const scrollToEnd = () => {
      if (!stickRef.current) return;
      el.scrollTop = el.scrollHeight;
    };

    // Le contenu vit dans les enfants du conteneur : on observe le conteneur
    // ET son premier enfant, dont la hauteur suit celle du document.
    const observer = new ResizeObserver(scrollToEnd);
    observer.observe(el);
    const content = el.firstElementChild;
    if (content) observer.observe(content);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
    /* eslint-enable react-hooks/immutability */
  }, [container, enabled]);
}
