import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { hashToken } from './security.js';

type JsonResponder = (res: ServerResponse, status: number, body: unknown) => void;

type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  pool: Pool;
  url: URL;
  method: string;
  user: { id: string };
  json: JsonResponder;
};

function cookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function currentTokenHash(req: IncomingMessage): string | null {
  const token = cookie(req, 'imdssa_session');
  return token ? hashToken(token) : null;
}

export async function handleSessionApi(context: Context): Promise<boolean> {
  const { req, res, pool, url, method, user, json } = context;
  const base = '/api/auth/sessions';
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return false;

  const tokenHash = currentTokenHash(req);
  if (!tokenHash) { json(res, 401, { error: 'AUTH_REQUIRED' }); return true; }

  if (url.pathname === base && method === 'GET') {
    const result = await pool.query(`select id,created_at,last_seen_at,expires_at,source_ip::text source_ip,user_agent,
      token_hash=$2 as is_current
      from app.auth_sessions
      where user_id=$1 and expires_at>now()
      order by is_current desc,last_seen_at desc,created_at desc`, [user.id, tokenHash]);
    json(res, 200, { items: result.rows });
    return true;
  }

  if (url.pathname === `${base}/revoke-others` && method === 'POST') {
    const result = await pool.query('delete from app.auth_sessions where user_id=$1 and token_hash<>$2 returning id', [user.id, tokenHash]);
    json(res, 200, { revoked: result.rowCount || 0 });
    return true;
  }

  const match = url.pathname.match(/^\/api\/auth\/sessions\/([0-9a-f-]+)$/i);
  if (match && method === 'DELETE') {
    const current = await pool.query<{ token_hash: string }>('select token_hash from app.auth_sessions where id=$1 and user_id=$2', [match[1], user.id]);
    if (!current.rowCount) { json(res, 404, { error: 'SESSION_NOT_FOUND' }); return true; }
    if (current.rows[0].token_hash === tokenHash) { json(res, 409, { error: 'CURRENT_SESSION_CANNOT_BE_REVOKED' }); return true; }
    await pool.query('delete from app.auth_sessions where id=$1 and user_id=$2', [match[1], user.id]);
    json(res, 200, { revoked: true });
    return true;
  }

  json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  return true;
}
