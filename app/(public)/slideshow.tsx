"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Slide {
  src: string;
  title: string | null;
  positionX?: number;
  positionY?: number;
}

interface SlideshowProps {
  slides: Slide[];
  interval?: number;
}

export function Slideshow({ slides, interval = 4000 }: SlideshowProps) {
  const [current, setCurrent] = useState(0);

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  const prev = useCallback(() => {
    setCurrent((p) => (p - 1 + slides.length) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(next, interval);
    return () => clearInterval(timer);
  }, [next, interval, slides.length]);

  return (
    <div className="relative w-full aspect-[21/9] max-h-[50vh] overflow-hidden bg-black">
      {slides.map((slide, index) => (
        <div
          key={index}
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: index === current ? 1 : 0 }}
        >
          <img
            src={slide.src}
            alt={slide.title ?? ""}
            className="h-full w-full object-cover"
            style={{ objectPosition: `${slide.positionX ?? 50}% ${slide.positionY ?? 50}%` }}
          />
          {slide.title && (
            <>
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10">
                <h2 className="text-2xl md:text-4xl font-bold text-white">
                  {slide.title}
                </h2>
              </div>
            </>
          )}
        </div>
      ))}

      {/* Chevrons */}
      {slides.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
          >
            <ChevronLeft className="h-16 w-16" />
          </button>
          <button
            onClick={next}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
          >
            <ChevronRight className="h-16 w-16" />
          </button>
        </>
      )}

      {/* Dots */}
      {slides.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrent(index)}
              className={`h-2 w-2 rounded-full transition-colors ${
                index === current ? "bg-white" : "bg-white/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
