"use client";

import { useEffect } from "react";

/**
 * Switches the whole page into the "collab" color theme while mounted.
 *
 * Rendered by the browse page only when the selected category is a collab
 * category. It sets `data-theme="collab"` on <html>, which globals.css uses to
 * reshuffle the brand palette (page background, ink, and accents) so collab
 * designs are visually distinct from the main catalog. The attribute is
 * removed on unmount, so navigating anywhere else restores the normal look.
 */
export default function CollabTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "collab";
    return () => {
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
    };
  }, []);
  return null;
}
