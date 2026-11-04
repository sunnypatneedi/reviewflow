import { isIP } from "node:net";
/** Public listeners require an explicit operator choice; local tools stay loopback. */
export function resolveListenHost(env = process.env) {
  const host = env.REVIEWFLOW_HOST || "127.0.0.1";
  if (!isIP(host)) throw new Error("REVIEWFLOW_HOST must be an IP address");
  const optIn = env.REVIEWFLOW_PUBLIC_LISTEN;
  if (optIn !== undefined && optIn !== "true" && optIn !== "false")
    throw new Error("REVIEWFLOW_PUBLIC_LISTEN must be true or false");
  const local = host === "::1" || host.startsWith("127.");
  if (!local && optIn !== "true")
    throw new Error(
      "Non-loopback binding requires REVIEWFLOW_PUBLIC_LISTEN=true and deployment qualification",
    );
  return host;
}
