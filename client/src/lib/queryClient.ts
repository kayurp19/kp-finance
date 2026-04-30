import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Build URL: first key is path, optional 2nd key can be a query-string object
    let path = String(queryKey[0]);
    if (queryKey.length > 1 && typeof queryKey[1] === "object" && queryKey[1] !== null && !Array.isArray(queryKey[1])) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(queryKey[1] as Record<string, any>)) {
        if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
      }
      const qs = params.toString();
      if (qs) path += "?" + qs;
    } else if (queryKey.length > 1) {
      // Fallback: join remaining segments
      path = queryKey.map((p) => String(p)).join("/");
    }

    const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (res.status === 401) {
      // Force redirect to login
      if (!window.location.hash.startsWith("#/login")) {
        window.location.hash = "#/login";
      }
      throw new Error("401: Unauthorized");
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
