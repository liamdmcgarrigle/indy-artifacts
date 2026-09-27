import { requireOwner } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { requireArtifact } from "@/lib/service/artifacts";
import { activeLink, agentOrigin, emailGateAvailable, renewLink, setSharing, shareUrl, type Expiry, type ShareLink, type ShareMode } from "@/lib/service/sharing";
import { config } from "@/lib/config";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function state(slug: string, link: ShareLink | null) {
  const artifact = requireArtifact(getContext(), slug);
  return {
    mode: link?.mode ?? "private",
    link: link ? { ...link, url: shareUrl(link), agent: agentOrigin(getContext(), link.id) } : null,
    privateUrl: `${config().url}/a/${artifact.slug}`,
    emailGate: emailGateAvailable(),
    currentVersion: artifact.currentVersion,
  };
}

export async function GET(request: Request, { params }: Params) {
  try {
    requireOwner(getContext(), request);
    const { slug } = await params;
    return json(state(slug, activeLink(getContext(), slug)));
  } catch (err) {
    return fail(err);
  }
}

/** Change who can open the page, and how. */
export async function PUT(request: Request, { params }: Params) {
  try {
    requireOwner(getContext(), request);
    const { slug } = await params;
    const input = await body(request);
    const link = setSharing(getContext(), slug, {
      mode: String(input.mode ?? "private") as ShareMode,
      allowComments: typeof input.allow_comments === "boolean" ? input.allow_comments : undefined,
      expiry: input.expiry === undefined ? undefined : (String(input.expiry) as Expiry),
      pinnedVersion: input.pinned_version === undefined ? undefined : input.pinned_version === null ? null : Number(input.pinned_version),
    });
    return json(state(slug, link));
  } catch (err) {
    return fail(err);
  }
}

/** A new token for the same link; the old one stops working. */
export async function POST(request: Request, { params }: Params) {
  try {
    requireOwner(getContext(), request);
    const { slug } = await params;
    return json(state(slug, renewLink(getContext(), slug)));
  } catch (err) {
    return fail(err);
  }
}
