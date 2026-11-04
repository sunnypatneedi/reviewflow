/** Coalesce/cache probes to keep readiness traffic from filling the DB pool. */
export function createReadiness(
  probe: () => Promise<unknown>,
  now = () => performance.now(),
) {
  let pending: Promise<boolean> | undefined;
  let cached: { at: number; ready: boolean } | undefined;
  return async () => {
    if (cached && now() - cached.at < 500) return cached.ready;
    if (!pending)
      pending = Promise.resolve()
        .then(probe)
        .then(
          () => true,
          () => false,
        )
        .then((ready) => {
          cached = { at: now(), ready };
          return ready;
        })
        .finally(() => {
          pending = undefined;
        });
    return pending;
  };
}
