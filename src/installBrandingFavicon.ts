import faviconSrc from "./assets/icon-square.png";

/**
 * Applies bundled PNG favicons (Vite-resolved URL). `index.html` should not
 * reference another `rel="icon"` that would override this.
 */
export function installBrandingFavicon(): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/png";
  link.href = faviconSrc;

  let apple = document.querySelector<HTMLLinkElement>(
    'link[rel="apple-touch-icon"]',
  );
  if (!apple) {
    apple = document.createElement("link");
    apple.rel = "apple-touch-icon";
    document.head.appendChild(apple);
  }
  apple.href = faviconSrc;
}
