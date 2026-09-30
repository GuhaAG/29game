export interface ApiError {
  code: string;
  message: string;
  retryAfterMs?: number;
}

export class RequestFailed extends Error {
  constructor(public readonly info: ApiError) {
    super(info.message);
    this.name = 'RequestFailed';
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; csrfToken?: string | null; admission?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.csrfToken) headers['x-csrf-token'] = options.csrfToken;
  if (options.admission) headers['x-admission'] = options.admission;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new RequestFailed({ code: 'OFFLINE', message: 'No connection to the server. Check your network.' });
  }
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = (parsed.error ?? {}) as Partial<ApiError>;
    throw new RequestFailed({
      code: error.code ?? 'SERVER_ERROR',
      message: error.message ?? 'Something went wrong. Please try again.',
    });
  }
  return parsed as T;
}

export const api = {
  rules: () => request<{ rulesVersion: number; sections: { heading: string; points: string[] }[] }>('GET', '/api/rules'),
  createRoom: (name: string, seat: number) =>
    request<{ roomId: string; password: string; seat: number; name: string; csrfToken: string }>(
      'POST',
      '/api/rooms',
      { body: { name, seat } },
    ),
  admission: (roomId: string, password: string) =>
    request<{ token: string; expiresAt: string }>('POST', `/api/rooms/${roomId}/admission`, {
      body: { password },
    }),
  seats: (roomId: string, admission: string) =>
    request<{ status: string; seats: { seat: number; team: number; name: string | null }[] }>(
      'GET',
      `/api/rooms/${roomId}/seats`,
      { admission },
    ),
  claim: (roomId: string, admission: string, name: string, seat: number, csrfToken: string | null) =>
    request<{ seat: number; name: string; csrfToken: string }>('POST', `/api/rooms/${roomId}/claim`, {
      body: { name, seat },
      admission,
      csrfToken,
    }),
  state: (roomId: string) =>
    request<{ snapshot: unknown; csrfToken: string }>('GET', `/api/rooms/${roomId}/state`),
  recover: (roomId: string, code: string) =>
    request<{ seat: number; csrfToken: string }>('POST', `/api/rooms/${roomId}/recover`, { body: { code } }),
};
