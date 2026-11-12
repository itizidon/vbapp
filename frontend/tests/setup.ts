import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import type { ImageProps } from "next/image";
import { afterEach, vi } from "vitest";
afterEach(cleanup);

// Vitest imports PNGs as URLs; production Next imports include hashed URLs/dimensions.
// Browser tests exercise the real optimizer and image loading.
vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: ImageProps) =>
    createElement("img", {
      ...props,
      alt,
      src:
        typeof src === "string"
          ? src
          : "default" in src
            ? src.default.src
            : src.src,
    }),
}));
