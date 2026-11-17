import type { NextFunction, Request, Response } from 'express';
import { sha256 } from './crypto.ts';
import type { AppDatabase } from './db.ts';
import type { AuthContext, OrganizationRole } from './types.ts';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      cookies?: Record<string, string>;
    }
  }
}

export const SESSION_COOKIE_NAME = 'meridian_session';

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) result[key] = val;
  }
  return result;
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers.cookie);
  req.cookies = cookies;
  return cookies[SESSION_COOKIE_NAME] || null;
}

export function attachAuth(db: AppDatabase) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractSessionToken(req);
    if (!token) {
      return next();
    }
    const tokenHash = sha256(token);
    const nowIso = new Date().toISOString();

    const row = db
      .prepare(
        `
        SELECT
          s.id AS session_id,
          s.user_id,
          s.active_organization_id,
          s.mfa_verified,
          s.expires_at,
          s.revoked_at,
          u.email,
          u.full_name,
          u.email_verified,
          u.mfa_enabled,
          u.is_platform_admin
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
      `,
      )
      .get(tokenHash) as Record<string, unknown> | undefined;

    if (!row || row.revoked_at || String(row.expires_at) <= nowIso) {
      return next();
    }

    const activeOrgId = row.active_organization_id as string | null;
    if (!activeOrgId) {
      return next();
    }

    const membership = db
      .prepare(
        `
        SELECT
          m.role,
          o.id AS org_id,
          o.name AS org_name,
          o.slug AS org_slug,
          o.status AS org_status
        FROM organization_members m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND m.organization_id = ? AND m.status = 'ACTIVE'
      `,
      )
      .get(String(row.user_id), activeOrgId) as Record<string, unknown> | undefined;

    if (!membership || membership.org_status !== 'ACTIVE') {
      if (!row.is_platform_admin) {
        return next();
      }
    }

    req.auth = {
      sessionId: String(row.session_id),
      userId: String(row.user_id),
      email: String(row.email),
      fullName: String(row.full_name),
      emailVerified: Boolean(row.email_verified),
      mfaEnabled: Boolean(row.mfa_enabled),
      mfaVerified: Boolean(row.mfa_verified),
      isPlatformAdmin: Boolean(row.is_platform_admin),
      organizationId: membership ? String(membership.org_id) : activeOrgId,
      organizationName: membership ? String(membership.org_name) : 'Platform Administration',
      organizationSlug: membership ? String(membership.org_slug) : 'platform',
      role: (membership ? String(membership.role) : 'AGENCY_ADMIN') as OrganizationRole,
    };

    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function requireRoles(...allowedRoles: OrganizationRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.auth.isPlatformAdmin) {
      return next();
    }
    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        error: `Forbidden: requires role ${allowedRoles.join(' or ')}`,
      });
      return;
    }
    next();
  };
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!req.auth.isPlatformAdmin) {
    res.status(403).json({ error: 'Forbidden: platform super administrator access required' });
    return;
  }
  next();
}
