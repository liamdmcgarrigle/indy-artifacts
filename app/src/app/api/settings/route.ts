import { getContext } from "@/lib/service/context";
import { requireOwner } from "@/lib/auth/access";
import { getSettings, updateSettings } from "@/lib/service/settings";
import { dataUsage } from "@/lib/service/storage";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

async function state() {
  const ctx = getContext();
  return { settings: getSettings(ctx), usage: await dataUsage(ctx) };
}

export async function GET(request: Request) {
  try {
    requireOwner(getContext(), request);
    return json(await state());
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    const input = await body(request);
    updateSettings(ctx, {
      storageLimitMb: input.storage_limit_mb,
      compressImages: input.compress_images,
      imageMaxEdge: input.image_max_edge,
      imageQuality: input.image_quality,
    });
    return json(await state());
  } catch (err) {
    return fail(err);
  }
}
