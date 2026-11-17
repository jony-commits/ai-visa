import { Router } from 'express';
import { hashPassword, randomToken, sha256 } from '../crypto.ts';
import { AppDatabase, newId, writeAuditLog } from '../db.ts';
import { requireAuth, requirePlatformAdmin, requireRoles } from '../middleware.ts';
import { ORGANIZATION_ROLES, OrganizationRole } from '../types.ts';

export function createOrganizationsRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/organizations/current', requireAuth, (req, res) => {
    const org = db
      .prepare('SELECT id, name, slug, country_code, plan_tier, status, created_at FROM organizations WHERE id = ?')
      .get(req.auth!.organizationId);
    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    res.json({ organization: org });
  });

  router.patch(
    '/organizations/current',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const { name, countryCode } = req.body as { name?: string; countryCode?: string };
      if (!name?.trim()) {
        res.status(400).json({ error: 'Organization name is required' });
        return;
      }
      const now = new Date().toISOString();
      db.prepare(
        'UPDATE organizations SET name = ?, country_code = COALESCE(?, country_code), updated_at = ? WHERE id = ?',
      ).run(name.trim(), countryCode || null, now, req.auth!.organizationId);

      writeAuditLog(db, {
        organizationId: req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'ORGANIZATION_UPDATED',
        resourceType: 'Organization',
        resourceId: req.auth!.organizationId,
        metadata: { name: name.trim(), countryCode },
        ipAddress: req.ip,
      });

      const updated = db
        .prepare('SELECT id, name, slug, country_code, plan_tier, status, created_at FROM organizations WHERE id = ?')
        .get(req.auth!.organizationId);
      res.json({ organization: updated });
    },
  );

  router.get(
    '/organizations/members',
    requireAuth,
    requireRoles('AGENCY_ADMIN', 'CONSULTANT', 'VERIFICATION_OFFICER'),
    (req, res) => {
      const members = db
        .prepare(
          `
          SELECT
            m.id AS member_id,
            m.user_id,
            m.role,
            m.status,
            m.created_at,
            u.email,
            u.full_name,
            u.email_verified,
            u.mfa_enabled
          FROM organization_members m
          JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = ?
          ORDER BY m.created_at ASC
        `,
        )
        .all(req.auth!.organizationId);

      const invitations = db
        .prepare(
          `
          SELECT id, email, role, accepted_at, expires_at, created_at
          FROM invitations
          WHERE organization_id = ?
          ORDER BY created_at DESC
        `,
        )
        .all(req.auth!.organizationId);

      res.json({ members, invitations });
    },
  );

  router.post(
    '/organizations/invitations',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const { email, role } = req.body as { email?: string; role?: OrganizationRole };
      if (!email || !role || !ORGANIZATION_ROLES.includes(role)) {
        res.status(400).json({ error: 'Valid email and organization role are required' });
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const existingMember = db
        .prepare(
          `
          SELECT m.id FROM organization_members m
          JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = ? AND u.email = ?
        `,
        )
        .get(req.auth!.organizationId, normalizedEmail);

      if (existingMember) {
        res.status(409).json({ error: 'User is already a member of this organization' });
        return;
      }

      const token = randomToken(24);
      const id = newId('inv');
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO invitations (id, organization_id, email, role, token_hash, invited_by_user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        req.auth!.organizationId,
        normalizedEmail,
        role,
        sha256(token),
        req.auth!.userId,
        expiresAt,
        now,
      );

      writeAuditLog(db, {
        organizationId: req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'MEMBER_INVITED',
        resourceType: 'Invitation',
        resourceId: id,
        metadata: { email: normalizedEmail, role },
        ipAddress: req.ip,
      });

      res.status(201).json({
        invitation: {
          id,
          email: normalizedEmail,
          role,
          expiresAt,
        },
        inviteTokenPreview: token,
      });
    },
  );

  router.post('/invitations/accept', (req, res) => {
    const { token, fullName, password } = req.body as {
      token?: string;
      fullName?: string;
      password?: string;
    };
    if (!token) {
      res.status(400).json({ error: 'Invitation token is required' });
      return;
    }

    const invite = db
      .prepare('SELECT * FROM invitations WHERE token_hash = ? AND accepted_at IS NULL')
      .get(sha256(token)) as Record<string, unknown> | undefined;

    if (!invite || String(invite.expires_at) <= new Date().toISOString()) {
      res.status(400).json({ error: 'Invitation is invalid or expired' });
      return;
    }

    const now = new Date().toISOString();
    let user = db
      .prepare('SELECT id, email, full_name FROM users WHERE email = ?')
      .get(String(invite.email)) as { id: string; email: string; full_name: string } | undefined;

    if (!user) {
      if (!fullName?.trim() || !password || password.length < 8) {
        res.status(400).json({
          error: 'Full name and password (8+ chars) are required to activate invited account',
        });
        return;
      }
      const userId = newId('usr');
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, email_verified, mfa_enabled, is_platform_admin, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 0, 0, ?, ?)
      `).run(userId, String(invite.email), hashPassword(password), fullName.trim(), now, now);
      user = { id: userId, email: String(invite.email), full_name: fullName.trim() };
    }

    const existingMembership = db
      .prepare('SELECT id FROM organization_members WHERE organization_id = ? AND user_id = ?')
      .get(String(invite.organization_id), user.id);

    if (!existingMembership) {
      db.prepare(`
        INSERT INTO organization_members (id, organization_id, user_id, role, status, created_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?)
      `).run(newId('mem'), String(invite.organization_id), user.id, String(invite.role), now);
    }

    db.prepare('UPDATE invitations SET accepted_at = ? WHERE id = ?').run(now, String(invite.id));

    writeAuditLog(db, {
      organizationId: String(invite.organization_id),
      actorUserId: user.id,
      action: 'INVITATION_ACCEPTED',
      resourceType: 'Invitation',
      resourceId: String(invite.id),
      metadata: { role: invite.role },
      ipAddress: req.ip,
    });

    res.json({
      accepted: true,
      email: user.email,
      organizationId: invite.organization_id,
      role: invite.role,
    });
  });

  router.patch(
    '/organizations/members/:memberId/role',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const { role } = req.body as { role?: OrganizationRole };
      if (!role || !ORGANIZATION_ROLES.includes(role)) {
        res.status(400).json({ error: 'Valid role is required' });
        return;
      }

      const member = db
        .prepare('SELECT id, user_id, role FROM organization_members WHERE id = ? AND organization_id = ?')
        .get(req.params.memberId, req.auth!.organizationId) as
        | { id: string; user_id: string; role: string }
        | undefined;

      if (!member) {
        res.status(404).json({ error: 'Member not found in your organization' });
        return;
      }

      db.prepare('UPDATE organization_members SET role = ? WHERE id = ? AND organization_id = ?').run(
        role,
        member.id,
        req.auth!.organizationId,
      );

      writeAuditLog(db, {
        organizationId: req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'MEMBER_ROLE_UPDATED',
        resourceType: 'OrganizationMember',
        resourceId: member.id,
        metadata: { previousRole: member.role, newRole: role },
        ipAddress: req.ip,
      });

      res.json({ updated: true, memberId: member.id, role });
    },
  );

  router.get('/admin/tenants', requireAuth, requirePlatformAdmin, (_req, res) => {
    const nowIso = new Date().toISOString();
    const tenants = db
      .prepare(
        `
        SELECT
          o.id, o.name, o.slug, o.country_code, o.plan_tier, o.status, o.created_at,
          (SELECT COUNT(*) FROM organization_members m WHERE m.organization_id = o.id) AS member_count,
          (SELECT COUNT(*) FROM visa_applications a WHERE a.organization_id = o.id) AS case_count,
          (SELECT COUNT(*) FROM visa_applications a WHERE a.organization_id = o.id AND a.stage_due_at IS NOT NULL AND a.stage_due_at < ? AND a.internal_status NOT IN ('APPROVED', 'REJECTED', 'WITHDRAWN', 'CLOSED')) AS overdue_cases_count,
          (SELECT COUNT(*) FROM verification_issues vi WHERE vi.organization_id = o.id AND vi.status = 'OPEN') AS open_issues_count,
          (SELECT COUNT(*) FROM notification_jobs nj WHERE nj.organization_id = o.id AND nj.status IN ('RETRY_WAIT', 'FAILED_PERMANENT')) AS failed_notifications_count,
          (SELECT COUNT(*) FROM ai_usage_logs aiu WHERE aiu.organization_id = o.id) AS ai_call_count,
          (SELECT COALESCE(SUM(aiu.input_tokens + aiu.output_tokens), 0) FROM ai_usage_logs aiu WHERE aiu.organization_id = o.id) AS ai_total_tokens
        FROM organizations o
        ORDER BY o.created_at ASC
      `,
      )
      .all(nowIso);

    const processingQueue = db
      .prepare('SELECT status, COUNT(*) AS count FROM processing_jobs GROUP BY status')
      .all();
    const notificationQueue = db
      .prepare('SELECT status, COUNT(*) AS count FROM notification_jobs GROUP BY status')
      .all();
    const ruleSummary = db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM visa_countries WHERE enabled = 1) AS countries_count,
          (SELECT COUNT(*) FROM visa_categories) AS categories_count,
          (SELECT COUNT(*) FROM visa_routes) AS routes_count,
          (SELECT COUNT(*) FROM visa_form_schemas) AS form_schemas_count
      `,
      )
      .get();

    res.json({ tenants, processingQueue, notificationQueue, ruleSummary });
  });

  router.patch('/admin/tenants/:orgId/status', requireAuth, requirePlatformAdmin, (req, res) => {
    const { status } = req.body as { status?: 'ACTIVE' | 'SUSPENDED' | 'PENDING' };
    if (!status || !['ACTIVE', 'SUSPENDED', 'PENDING'].includes(status)) {
      res.status(400).json({ error: 'Valid organization status is required' });
      return;
    }
    const existing = db
      .prepare('SELECT id, status FROM organizations WHERE id = ?')
      .get(req.params.orgId) as { id: string; status: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    db.prepare('UPDATE organizations SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      new Date().toISOString(),
      existing.id,
    );

    writeAuditLog(db, {
      organizationId: existing.id,
      actorUserId: req.auth!.userId,
      action: 'TENANT_STATUS_UPDATED',
      resourceType: 'Organization',
      resourceId: existing.id,
      metadata: { previousStatus: existing.status, newStatus: status },
      ipAddress: req.ip,
    });

    res.json({ updated: true, organizationId: existing.id, status });
  });

  router.get(
    '/audit-logs',
    requireAuth,
    requireRoles('AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      const { action, resourceType, search, limit } = req.query as {
        action?: string;
        resourceType?: string;
        search?: string;
        limit?: string;
      };

      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (!req.auth!.isPlatformAdmin) {
        conditions.push('a.organization_id = ?');
        params.push(req.auth!.organizationId);
      }

      if (action && action !== 'ALL') {
        conditions.push('a.action = ?');
        params.push(action);
      }

      if (resourceType && resourceType !== 'ALL') {
        conditions.push('a.resource_type = ?');
        params.push(resourceType);
      }

      if (search?.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        conditions.push(
          '(LOWER(COALESCE(u.email, \'\')) LIKE ? OR LOWER(COALESCE(a.action, \'\')) LIKE ? OR LOWER(COALESCE(a.resource_id, \'\')) LIKE ? OR LOWER(COALESCE(a.metadata_json, \'\')) LIKE ?)',
        );
        params.push(q, q, q, q);
      }

      const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rowLimit = Math.max(10, Math.min(200, Number(limit || 100) || 100));
      params.push(rowLimit);

      const rows = db
        .prepare(
          `
          SELECT a.*, u.email AS actor_email, u.full_name AS actor_name, o.name AS organization_name
          FROM audit_logs a
          LEFT JOIN users u ON u.id = a.actor_user_id
          LEFT JOIN organizations o ON o.id = a.organization_id
          ${whereSql}
          ORDER BY a.created_at DESC
          LIMIT ?
        `,
        )
        .all(...params);

      res.json({ logs: rows });
    },
  );

  return router;
}
