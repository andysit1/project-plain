// Minimal HTTP client used by the demo web app.

const BASE_URL = "https://example.invalid/api";

export async function request(path: string): Promise<any> {
  const url = buildUrl(path);
  const res = await fetch(url);
  return res.json();
}

export function buildUrl(path: string): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `${BASE_URL}/${clean}`;
}
