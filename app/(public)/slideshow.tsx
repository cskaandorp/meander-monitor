"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface Slide {
  src: string;
  title: string | null;
  positionX?: number;
  positionY?: number;
}

interface Cta {
  eyebrow?: string;
  text: string;
  href: string;
}

interface SlideshowProps {
  slides: Slide[];
  interval?: number;
  cta?: Cta;
}

// Placeholder until the real call-to-action copy is decided.
const DEFAULT_CTA: Cta = {
  eyebrow: "TAKE PART",
  text: "Film a river bend and send us your video",
  href: "/submit",
};

/*
 * Reconstructed from wur.nl's #pageheader-home. The cutouts are NOT masks:
 * WUR overlays cream shapes (page-background colour) on the image, and the image
 * appears to scoop around their rounded corners. Values are theirs:
 *   panel radius 30px · card wrapper radius `0 40px 0 30px`, padding 16px top/right
 *   cream = --background (#FBF6E5 in the WUR theme)
 */
export function Slideshow({ slides, interval = 4000, cta = DEFAULT_CTA }: SlideshowProps) {
  const [current, setCurrent] = useState(0);

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(next, interval);
    return () => clearInterval(timer);
  }, [next, interval, slides.length]);

  return (
    // Capped at 1000px, centred on wider screens.
    <div className="relative mx-auto w-full max-w-[1000px]">
      {/* The image panel — rounded 30px, clipped. No mask. */}
      <div className="relative aspect-[16/9] max-h-[600px] w-full overflow-hidden rounded-[30px] bg-muted">
        {slides.map((slide, index) => (
          <div
            key={index}
            className="absolute inset-0 transition-opacity duration-700"
            style={{ opacity: index === current ? 1 : 0 }}
          >
            <img
              src={slide.src}
              alt={slide.title ?? ""}
              className="absolute inset-0 block h-full w-full object-cover"
              style={{ objectPosition: `${slide.positionX ?? 50}% ${slide.positionY ?? 50}%` }}
            />
            {slide.title && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
            )}
          </div>
        ))}

        {/* Dots, top-left, over the image. */}
        {slides.length > 1 && (
          <div className="absolute left-6 top-5 z-20 flex gap-2">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrent(index)}
                aria-label={`Go to slide ${index + 1}`}
                className={`h-2 w-2 rounded-full transition-colors ${
                  index === current ? "bg-white" : "bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Green CTA card in the bottom-left cutout. The cream wrapper's 16px
          top/right padding is the gap; its rounded corners are what the image
          appears to scoop around. */}
      {cta && (
        <Link
          href={cta.href}
          className="absolute bottom-0 left-0 z-10 w-[58%] max-w-[240px] bg-background pr-4 pt-4"
          // top-right 40 = the scoop (convex cream = concave image). bottom-left
          // 30 nests into the panel corner. The other two corners — where the
          // card's top meets the image's left edge, and its right meets the
          // bottom — are rounded by the inlaid fillets below, so they curve as
          // part of the IMAGE, not the card.
          style={{ borderRadius: "0 40px 0 30px" }}
        >
          {/* Inlaid corner fillets: a cream quarter with a transparent bite, so
              the image edge sweeps around it. If a curve comes out inverted,
              flip its gradient position (e.g. "at top right" -> "at bottom
              left"). */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-[-30px] h-[30px] w-[30px]"
            style={{ background: "radial-gradient(circle 30px at top right, transparent 29px, var(--background) 30px)" }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 right-[-30px] h-[30px] w-[30px]"
            style={{ background: "radial-gradient(circle 30px at top right, transparent 29px, var(--background) 30px)" }}
          />
          <div className="flex h-full flex-col gap-6 rounded-[20px] bg-accent p-6 text-accent-foreground transition-transform hover:scale-[1.01]">
            {cta.eyebrow && (
              <span className="text-xs font-semibold tracking-wide">{cta.eyebrow}</span>
            )}
            <span className="text-lg font-semibold leading-snug">{cta.text}</span>
            <span className="mt-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </Link>
      )}

      {/* Circular next control — cream circle straddling the right edge, dark
          button inside, so the image scoops around it (WUR's vbdvwwa). */}
      {slides.length > 1 && (
        <div
          className="absolute right-0 top-1/2 z-10 rounded-full bg-background p-3"
          style={{ transform: "translate(50%, -50%)" }}
        >
          <button
            onClick={next}
            aria-label="Next slide"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
          >
            <ArrowRight className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}
