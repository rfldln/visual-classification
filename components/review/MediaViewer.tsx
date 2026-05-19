"use client";

import type { FrameDTO } from "@/types";
import { useState } from "react";
import clsx from "clsx";

export function MediaViewer({ frame }: { frame: FrameDTO }) {
  const [zoom, setZoom] = useState(false);
  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
        onMouseEnter={() => setZoom(true)}
        onMouseLeave={() => setZoom(false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frame.url}
          alt={frame.source.originalName}
          className={clsx(
            "max-h-full max-w-full select-none object-contain transition-transform duration-150",
            zoom ? "scale-150 cursor-zoom-out" : "cursor-zoom-in",
          )}
          draggable={false}
        />
      </div>
    </div>
  );
}
