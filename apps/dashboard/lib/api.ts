const API_URL = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  // A FormData body must never get a manual Content-Type - the browser
  // sets its own, including the multipart boundary, and overriding it
  // breaks the upload silently (the server can't parse either shape).
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.error ?? "Request failed.", response.status);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json() as Promise<T>;
}
