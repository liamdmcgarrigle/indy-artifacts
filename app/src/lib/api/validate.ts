import { z } from "zod";
import { PUBLISH_SHAPE } from "../mcp/tools";
import { ValidationError } from "../service/errors";

/**
 * The HTTP API takes the same fields as the MCP tools and checks them the
 * same way, so a wrong type is a 400 with the field named, not a crash.
 */
const publishInput = z.object(PUBLISH_SHAPE);

export function parsePublish(payload: unknown): z.infer<typeof publishInput> {
  const parsed = publishInput.safeParse(payload);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
  throw new ValidationError(`the request is not right: ${problems.join("; ")}`);
}
