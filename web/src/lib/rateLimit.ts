const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 5000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientId(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Per-instance limiter. It bounds what one client can make a single function instance fetch upstream. */
export function rateLimited(request: Request, route: string, maxPerMinute: number): Response | null {
  const now = Date.now();
  const id = `${route}:${clientId(request)}`;
  const bucket = buckets.get(id);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_CLIENTS) buckets.clear();
    buckets.set(id, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  if (bucket.count >= maxPerMinute) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return Response.json(
      { error: `Too many requests. Try again in ${retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  buckets.set(id, { ...bucket, count: bucket.count + 1 });
  return null;
}
