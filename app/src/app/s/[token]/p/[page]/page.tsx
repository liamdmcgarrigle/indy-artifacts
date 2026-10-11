import type { Metadata } from "next";
import { renderShared, sharedMetadata } from "@/lib/shared-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string; page: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token, page } = await params;
  return sharedMetadata(token, page);
}

/** A page under a shared page: the link covers it too. */
export default async function SharedSubpage({ params }: Params) {
  const { token, page } = await params;
  return renderShared(token, page);
}
