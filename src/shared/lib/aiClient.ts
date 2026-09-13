import { supabase } from "./supabase";

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

// Calls a RoadStar AI route with the signed-in dispatcher's Supabase session.
// The browser never talks to the model provider and never sees its key.
export async function postAi<T>(path: `/api/ai/${string}`, body: unknown, timeoutMs = 30_000): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new AiRequestError("Sign in to use RoadStar AI.", 401, "unauthenticated");

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new AiRequestError(
      timedOut ? "RoadStar AI took too long to answer." : "RoadStar AI is unreachable.",
      0,
      timedOut ? "timeout" : "network",
    );
  }

  const payload = (await response.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!response.ok || !payload) {
    throw new AiRequestError(payload?.error ?? `RoadStar AI returned ${response.status}.`, response.status, payload?.code);
  }
  return payload;
}
