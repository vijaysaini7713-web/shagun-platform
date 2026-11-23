import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anon);

// The anon key is public by design; all protection is in RLS + DB functions.
export const supabase = createClient(url ?? "http://localhost:54321", anon ?? "public-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const MEDIA_BUCKET = "shagun-media";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown>) {
    super(code);
  }
}

/** Calls an edge function; throws ApiError with the server's error code. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? anon ?? "";
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anon ?? "" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? (json.otp_required ? "otp_required" : "error")), json);
  return json as T;
}

export async function uploadToSigned(path: string, token: string, blob: Blob) {
  const { error } = await supabase.storage.from(MEDIA_BUCKET).uploadToSignedUrl(path, token, blob, {
    contentType: "image/jpeg",
  });
  if (error) throw error;
}

export async function signedPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
