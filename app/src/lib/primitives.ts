/**
 * The address of a primitives file, with the version Next worked out when it
 * built or started (next.config.ts), so a new release is never served from a
 * browser's copy of the old one.
 */
export function primitivesUrl(file: "primitives.js" | "primitives.css"): string {
  const version = process.env.INDY_PRIMITIVES_VERSION;
  return version ? `/primitives/${file}?v=${version}` : `/primitives/${file}`;
}
