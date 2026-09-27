import { ServiceError } from "../service/errors";

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}

export function fail(err: unknown): Response {
  if (err instanceof ServiceError) {
    const payload: Record<string, unknown> = { error: { code: err.code, message: err.message } };
    if ("currentVersion" in err) payload.current_version = (err as { currentVersion: number }).currentVersion;
    if ("details" in err && err.details) Object.assign(payload.error as object, err.details);
    return json(payload, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[artifacts] unhandled:", err);
  return json({ error: { code: "internal", message } }, { status: 500 });
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
