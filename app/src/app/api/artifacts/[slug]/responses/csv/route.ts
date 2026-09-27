import { getContext } from "@/lib/service/context";
import { requireOwner } from "@/lib/auth/access";
import { responsesCsv } from "@/lib/service/responses";
import { fail } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    const slug = (await params).slug;
    return new Response(responsesCsv(ctx, slug), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}-responses.csv"`,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
