// "Test this source": call the configured endpoint from the extension host and
// show a short sample, so users see real data before building anything.

import type { WorkflowNode } from '../core/types';

const s = (v: unknown) => String(v ?? '').trim();

export async function testSource(node: WorkflowNode): Promise<{ ok: boolean; detail: string }> {
  const c = node.config;
  let url = '';
  let method = 'GET';
  let body: string | undefined;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (node.type === 'source.rest') {
    url = `${s(c.baseUrl)}${s(c.path)}`;
    method = s(c.method) || 'GET';
    if (s(c.query)) {
      try {
        const q = JSON.parse(s(c.query));
        if (method === 'GET') url += (url.includes('?') ? '&' : '?') + new URLSearchParams(q).toString();
        else body = JSON.stringify(q);
      } catch {
        return { ok: false, detail: 'The query/body is not valid JSON.' };
      }
    }
  } else if (node.type === 'source.graphql') {
    url = s(c.endpoint);
    method = 'POST';
    body = JSON.stringify({ query: s(c.query) });
  } else if (node.type === 'source.knowledge') {
    url = s(c.endpoint);
    method = 'POST';
    body = JSON.stringify({ query: 'test', top_k: 1 });
  } else if (node.type === 'source.web') {
    url = s(c.url);
    headers.Accept = 'text/html,*/*';
  }
  if (!/^https?:\/\//.test(url)) return { ok: false, detail: 'Set a full URL (https://…) first.' };
  if (body) headers['Content-Type'] = 'application/json';

  const env = s(c.tokenEnv);
  const auth = s(c.auth);
  if (env && auth && auth !== 'none') {
    const secret = process.env[env];
    if (!secret) return { ok: false, detail: `${env} isn't set in VS Code's environment. Set it in your shell, restart VS Code, and try again.` };
    if (auth === 'api key header') headers['X-API-Key'] = secret;
    else if (auth === 'basic') headers.Authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
    else headers.Authorization = `Bearer ${secret}`;
  }

  try {
    const started = Date.now();
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let preview = text;
    try {
      preview = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* not JSON */
    }
    return { ok: res.ok, detail: `HTTP ${res.status} · ${Date.now() - started} ms\n\n${preview.slice(0, 1500)}${preview.length > 1500 ? '\n…' : ''}` };
  } catch (e) {
    return { ok: false, detail: `Request failed: ${(e as Error).message}` };
  }
}
