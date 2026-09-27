"use client";

import { useSyncExternalStore } from "react";
import { ago, agoLong } from "@/lib/time";

const subscribe = () => () => {};

/**
 * A relative time that the server can render too. The server's clock and
 * timezone are not the reader's, so once hydrated the element is swapped
 * (by key) for one worked out in the browser, instead of React keeping the
 * server's text and warning about the mismatch.
 */
export function Ago({ iso, long, className }: { iso: string; long?: boolean; className?: string }) {
  const browser = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <time key={browser ? "browser" : "server"} dateTime={iso} title={new Date(iso).toLocaleString()} className={className} suppressHydrationWarning>
      {(long ? agoLong : ago)(iso)}
    </time>
  );
}
