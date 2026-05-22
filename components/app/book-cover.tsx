"use client";

import { coverGradient } from "@/lib/utils/cover-color";
import Image from "next/image";
import { useState } from "react";

interface BookCoverProps {
  coverUrl: string | null;
  title: string;
  primaryAuthor: string;
}

/**
 * Book cover thumbnail with a typographic gradient fallback.
 *
 * Client component on purpose: it tracks image load failure via `onError` so a
 * missing or broken cover URL (common with OpenLibrary ISBN covers) degrades to
 * the gradient rather than a broken-image icon. `onError` is a DOM event
 * handler and cannot be passed from a Server Component.
 */
export function BookCover({ coverUrl, title, primaryAuthor }: BookCoverProps) {
  const [failed, setFailed] = useState(false);

  if (coverUrl && !failed) {
    return (
      <Image
        src={coverUrl}
        alt={`Cover of ${title}`}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px"
        className="object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className="absolute inset-0 flex flex-col justify-end p-3"
      style={{ background: coverGradient(title) }}
    >
      <p className="text-caption text-white/90 font-semibold line-clamp-3 leading-tight">{title}</p>
      <p className="text-[11px] text-white/60 mt-1 line-clamp-1 leading-tight">{primaryAuthor}</p>
    </div>
  );
}
