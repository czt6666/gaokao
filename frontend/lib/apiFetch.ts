/**
 * apiFetch — drop-in fetch() wrapper that silently handles 401 by clearing
 * the auth token and redirecting to /login. All other errors propagate normally.
 */

const API = process.env.NEXT_PUBLIC_API_URL || "";

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API}${path}`, { ...init, headers });

  if (res.status === 401) {
    try { localStorage.removeItem("auth_token"); } catch {}
    const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search : "";
    const loginUrl = currentPath && currentPath !== "/" ? `/login?redirect=${encodeURIComponent(currentPath)}` : "/login";
    if (typeof window !== "undefined") window.location.replace(loginUrl);
    return null;
  }

  return res;
}
