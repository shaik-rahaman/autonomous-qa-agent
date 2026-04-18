import type { APIRequestContext } from '@playwright/test';

/**
 * Send a GET request and return the parsed JSON body.
 * Throws if the response status is not 2xx.
 */
export async function getJson<T = unknown>(
  request: APIRequestContext,
  url: string,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await request.get(url, { headers });
  if (!response.ok()) {
    throw new Error(`GET ${url} failed with status ${response.status()}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Send a POST request with a JSON body and return the parsed JSON response.
 * Throws if the response status is not 2xx.
 */
export async function postJson<T = unknown>(
  request: APIRequestContext,
  url: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await request.post(url, { data: body, headers });
  if (!response.ok()) {
    throw new Error(`POST ${url} failed with status ${response.status()}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Send a DELETE request and assert the expected status code.
 */
export async function deleteResource(
  request: APIRequestContext,
  url: string,
  expectedStatus = 204,
): Promise<void> {
  const response = await request.delete(url);
  if (response.status() !== expectedStatus) {
    throw new Error(
      `DELETE ${url} returned ${response.status()}, expected ${expectedStatus}`,
    );
  }
}
