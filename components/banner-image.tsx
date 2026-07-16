"use client";

interface BannerImageProps {
  src: string;
  positionX: number;
  positionY: number;
}

export function BannerImage({ src, positionX, positionY }: BannerImageProps) {
  return (
    <div className="w-full bg-muted" style={{ aspectRatio: "21/6" }}>
      <img
        src={src}
        alt=""
        className="w-full h-full object-cover"
        style={{ objectPosition: `${positionX}% ${positionY}%` }}
      />
    </div>
  );
}
