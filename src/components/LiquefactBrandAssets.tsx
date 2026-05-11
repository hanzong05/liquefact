import type {ImgHTMLAttributes} from "react";
import iconLandscape from "../assets/icon-landscape-transparent.png";
import iconSquare from "../assets/icon-square.png";

const brandName = "Liquefact";

export {iconLandscape, iconSquare};

type SquareMarkProps = {
  /** CSS pixel size (width and height). */
  size?: number;
  className?: string;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height">;

/** Square app mark — headers, compact UI. */
export function LiquefactSquareMark({
  size = 44,
  className = "",
  alt = "",
  ...imgProps
}: SquareMarkProps) {
  return (
    <img
      {...imgProps}
      src={iconSquare}
      width={size}
      height={size}
      alt={alt}
      decoding="async"
      className={`shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-slate-900/10 ${className}`}
    />
  );
}

/** Horizontal wordmark — hero areas, modals. */
export function LiquefactLandscapeWordmark({
  className = "",
}: {
  className?: string;
}) {
  return (
    <img
      src={iconLandscape}
      alt={brandName}
      decoding="async"
      className={`h-auto w-full max-w-[min(100%,18rem)] object-contain object-center ${className}`}
    />
  );
}
