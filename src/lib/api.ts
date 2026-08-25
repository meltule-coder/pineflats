/**
 * Admin API fetch — always sends session cookie so saves succeed after login.
 */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: init.headers,
  });
}
