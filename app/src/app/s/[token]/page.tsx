import type { Metadata } from "next";
import { renderShared, sharedMetadata } from "@/lib/shared-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return sharedMetadata((await params).token);
}

export default async function SharedPage({ params }: Params) {
  return renderShared((await params).token);
}
