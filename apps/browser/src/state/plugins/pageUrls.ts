import { urlParts } from "../../lib/urlParts";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackPageUrl(url: string): boolean {
  if (url.length > 2048) return false;
  const parsed = urlParts(url);
  return !!parsed && parsed.scheme === "http" && LOOPBACK_HOSTS.has(parsed.host) && parsed.port !== "";
}
