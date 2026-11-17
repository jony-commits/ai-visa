import { Router } from 'express';
import {
  decryptField,
  encryptField,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from '../crypto.ts';
import { AppDatabase, newId, writeAuditLog } from '../db.ts';
import {
  buildOtpAuthUri,
  generateBackupCodes,
  generateTotpSecret,
  verifyTotpCode,
} from '../mfa.ts';
import { requireAuth, SESSION_COOKIE_NAME } from '../middleware.ts';
import { DEMO_PASSWORD } from '../seed.ts';
import type { OrganizationRole } from '../types.ts';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}

function setSessionCookie(res: import('express').Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function createAuthRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/demo-accounts', (_req, res) => {
    res.json({
      demoPassword: DEMO_PASSWORD,
      accounts: [
        {
          email: 'applicant@apexmobility.demo',
          fullName: 'Aarav Mehta',
          role: 'APPLICANT',
          organization: 'Apex Global Mobility',
        },
        {
          email: 'consultant@apexmobility.demo',
          fullName: 'Elena Rostova',
          role: 'CONSULTANT',
          organization: 'Apex Global Mobility',
        },
        {
          email: 'officer@apexmobility.demo',
          fullName: 'David Okafor',
          role: 'VERIFICATION_OFFICER',
          organization: 'Apex Global Mobility',
        },
        {
          email: 'admin@apexmobility.demo',
          fullName: 'Marcus Chen',
          role: 'AGENCY_ADMIN',
          organization: 'Apex Global Mobility',
        },
        {
          email: 'consultant@pacificrim.demo',
          fullName: 'Sofia Alvarez',
          role: 'CONSULTANT',
          organization: 'Pacific Rim Immigration',
        },
        {
          email: 'superadmin@meridianvisa.demo',
          fullName: 'Claire Vance',
          role: 'SUPER_ADMIN',
          organization: 'Platform Governance',
        },
      ],
    });
  });

  router.get('/public-organizations', (_req, res) => {
    const orgs = db
      .prepare("SELECT id, name, slug, country_code FROM organizations WHERE status = 'ACTIVE' ORDER BY name ASC")
      .all();
    res.json({ organizations: orgs });
  });

  router.post('/register', (req, res) => {
    const {
      email,
      password,
      fullName,
      accountType = 'APPLICANT',
      organizationName,
      organizationId,
      countryCode = 'US',
    } = req.body as {
      email?: string;
      password?: string;
      fullName?: string;
      accountType?: 'APPLICANT' | 'AGENCY_ADMIN';
      organizationName?: string;
      organizationId?: string;
      countryCode?: string;
    };

    if (!email || !password || !fullName) {
      res.status(400).json({ error: 'Email, password, and full name are required' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const now = new Date().toISOString();
    const userId = newId('usr');
    const verificationToken = randomToken(24);
    const passwordHash = hashPassword(password);

    let targetOrgId = '';
    let assignedRole: OrganizationRole = 'APPLICANT';

    if (accountType === 'AGENCY_ADMIN') {
      if (!organizationName?.trim()) {
        res.status(400).json({ error: 'Organization name is required for agency registration' });
        return;
      }
      targetOrgId = newId('org');
      const baseSlug = slugify(organizationName) || 'agency';
      const slug = `${baseSlug}-${randomToken(3)}`;
      db.prepare(`
        INSERT INTO organizations (id, name, slug, country_code, plan_tier, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'STANDARD', 'ACTIVE', ?, ?)
      `).run(targetOrgId, organizationName.trim(), slug, countryCode, now, now);
      assignedRole = 'AGENCY_ADMIN';
    } else {
      const requestedOrg = organizationId
        ? db.prepare("SELECT id FROM organizations WHERE id = ? AND status = 'ACTIVE'").get(organizationId)
        : db.prepare("SELECT id FROM organizations WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1").get();
      if (!requestedOrg) {
        res.status(400).json({ error: 'Selected organization is unavailable' });
        return;
      }
      targetOrgId = String((requestedOrg as { id: string }).id);
      assignedRole = 'APPLICANT';
    }

    db.prepare(`
      INSERT INTO users (
        id, email, password_hash, full_name, email_verified, verification_token_hash,
        mfa_enabled, is_platform_admin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, ?, 0, 0, ?, ?)
    `).run(userId, normalizedEmail, passwordHash, fullName.trim(), sha256(verificationToken), now, now);

    db.prepare(`
      INSERT INTO organization_members (id, organization_id, user_id, role, status, created_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?)
    `).run(newId('mem'), targetOrgId, userId, assignedRole, now);

    const sessionToken = randomToken(32);
    const sessionId = newId('ses');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, active_organization_id, mfa_verified, expires_at, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      sessionId,
      userId,
      sha256(sessionToken),
      targetOrgId,
      expiresAt,
      req.ip || null,
      req.headers['user-agent'] || null,
      now,
    );

    writeAuditLog(db, {
      organizationId: targetOrgId,
      actorUserId: userId,
      action: 'USER_REGISTERED',
      resourceType: 'User',
      resourceId: userId,
      metadata: { role: assignedRole },
      ipAddress: req.ip,
    });

    setSessionCookie(res, sessionToken);
    res.status(201).json({
      token: sessionToken,
      verificationTokenPreview: verificationToken,
      user: {
        id: userId,
        email: normalizedEmail,
        fullName: fullName.trim(),
        emailVerified: false,
        mfaEnabled: false,
        organizationId: targetOrgId,
        role: assignedRole,
      },
    });
  });

  router.post('/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as Record<string, unknown> | undefined;

    if (!user || !verifyPassword(password, String(user.password_hash))) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const membership = db
      .prepare(
        `
        SELECT m.organization_id, m.role, o.name AS org_name, o.slug AS org_slug
        FROM organization_members m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
        ORDER BY m.created_at ASC
        LIMIT 1
      `,
      )
      .get(String(user.id)) as Record<string, unknown> | undefined;

    if (!membership && !user.is_platform_admin) {
      res.status(403).json({ error: 'No active organization membership found for this account' });
      return;
    }

    const activeOrgId = membership ? String(membership.organization_id) : null;
    const now = new Date().toISOString();

    if (user.mfa_enabled) {
      const mfaChallengeToken = randomToken(24);
      const challengeExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, active_organization_id, mfa_verified, expires_at, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(
        newId('ses'),
        String(user.id),
        sha256(mfaChallengeToken),
        activeOrgId,
        challengeExpiry,
        req.ip || null,
        req.headers['user-agent'] || null,
        now,
      );

      res.json({
        mfaRequired: true,
        mfaChallengeToken,
      });
      return;
    }

    const sessionToken = randomToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, active_organization_id, mfa_verified, expires_at, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      newId('ses'),
      String(user.id),
      sha256(sessionToken),
      activeOrgId,
      expiresAt,
      req.ip || null,
      req.headers['user-agent'] || null,
      now,
    );

    writeAuditLog(db, {
      organizationId: activeOrgId,
      actorUserId: String(user.id),
      action: 'USER_LOGGED_IN',
      resourceType: 'Session',
      ipAddress: req.ip,
    });

    setSessionCookie(res, sessionToken);
    res.json({
      mfaRequired: false,
      token: sessionToken,
    });
  });

  router.post('/mfa/verify-login', (req, res) => {
    const { mfaChallengeToken, code } = req.body as {
      mfaChallengeToken?: string;
      code?: string;
    };
    if (!mfaChallengeToken || !code) {
      res.status(400).json({ error: 'Challenge token and verification code are required' });
      return;
    }

    const session = db
      .prepare(
        `
        SELECT s.*, u.mfa_secret_encrypted, u.mfa_backup_codes_hash
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL
      `,
      )
      .get(sha256(mfaChallengeToken)) as Record<string, unknown> | undefined;

    if (!session || String(session.expires_at) <= new Date().toISOString()) {
      res.status(401).json({ error: 'MFA challenge expired or invalid' });
      return;
    }

    let valid = false;
    if (session.mfa_secret_encrypted) {
      const secret = decryptField(String(session.mfa_secret_encrypted));
      valid = verifyTotpCode(secret, code);
    }

    if (!valid && session.mfa_backup_codes_hash) {
      const hashes = JSON.parse(String(session.mfa_backup_codes_hash)) as string[];
      const candidateHash = sha256(code.trim().toUpperCase());
      const idx = hashes.indexOf(candidateHash);
      if (idx !== -1) {
        valid = true;
        hashes.splice(idx, 1);
        db.prepare('UPDATE users SET mfa_backup_codes_hash = ? WHERE id = ?').run(
          JSON.stringify(hashes),
          String(session.user_id),
        );
      }
    }

    if (!valid) {
      res.status(401).json({ error: 'Invalid MFA verification code' });
      return;
    }

    const fullToken = randomToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'UPDATE sessions SET token_hash = ?, mfa_verified = 1, expires_at = ? WHERE id = ?',
    ).run(sha256(fullToken), expiresAt, String(session.id));

    writeAuditLog(db, {
      organizationId: (session.active_organization_id as string) || null,
      actorUserId: String(session.user_id),
      action: 'MFA_LOGIN_VERIFIED',
      resourceType: 'Session',
      resourceId: String(session.id),
      ipAddress: req.ip,
    });

    setSessionCookie(res, fullToken);
    res.json({ token: fullToken });
  });

  router.post('/verify-email', (req, res) => {
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: 'Verification token is required' });
      return;
    }
    const user = db
      .prepare('SELECT id FROM users WHERE verification_token_hash = ?')
      .get(sha256(token)) as { id: string } | undefined;

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired verification token' });
      return;
    }

    db.prepare(
      'UPDATE users SET email_verified = 1, verification_token_hash = NULL, updated_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), user.id);

    writeAuditLog(db, {
      actorUserId: user.id,
      action: 'EMAIL_VERIFIED',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({ verified: true });
  });

  router.post('/resend-verification', requireAuth, (req, res) => {
    const token = randomToken(24);
    db.prepare('UPDATE users SET verification_token_hash = ?, updated_at = ? WHERE id = ?').run(
      sha256(token),
      new Date().toISOString(),
      req.auth!.userId,
    );
    res.json({ sent: true, verificationTokenPreview: token });
  });

  router.post('/forgot-password', (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }
    const user = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as { id: string } | undefined;

    if (!user) {
      res.json({ requested: true });
      return;
    }

    const resetToken = randomToken(24);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
      'UPDATE users SET reset_token_hash = ?, reset_token_expires_at = ?, updated_at = ? WHERE id = ?',
    ).run(sha256(resetToken), expiresAt, new Date().toISOString(), user.id);

    writeAuditLog(db, {
      actorUserId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({ requested: true, resetTokenPreview: resetToken });
  });

  router.post('/reset-password', (req, res) => {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string };
    if (!token || !newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'Valid reset token and password (8+ chars) required' });
      return;
    }
    const user = db
      .prepare('SELECT id, reset_token_expires_at FROM users WHERE reset_token_hash = ?')
      .get(sha256(token)) as { id: string; reset_token_expires_at: string } | undefined;

    if (!user || user.reset_token_expires_at <= new Date().toISOString()) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires_at = NULL, updated_at = ? WHERE id = ?',
    ).run(hashPassword(newPassword), now, user.id);
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
      now,
      user.id,
    );

    writeAuditLog(db, {
      actorUserId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({ reset: true });
  });

  router.post('/logout', requireAuth, (req, res) => {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      req.auth!.sessionId,
    );
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ loggedOut: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    const memberships = db
      .prepare(
        `
        SELECT m.organization_id, m.role, o.name AS organization_name, o.slug
        FROM organization_members m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND m.status = 'ACTIVE'
      `,
      )
      .all(req.auth!.userId);

    res.json({
      user: req.auth,
      memberships,
    });
  });

  router.post('/mfa/setup', requireAuth, (req, res) => {
    const secret = generateTotpSecret();
    const otpAuthUri = buildOtpAuthUri(req.auth!.email, secret);
    db.prepare('UPDATE users SET mfa_secret_encrypted = ?, updated_at = ? WHERE id = ?').run(
      encryptField(secret),
      new Date().toISOString(),
      req.auth!.userId,
    );
    res.json({
      secret,
      otpAuthUri,
    });
  });

  router.post('/mfa/enable', requireAuth, (req, res) => {
    const { code } = req.body as { code?: string };
    if (!code) {
      res.status(400).json({ error: '6-digit TOTP code is required' });
      return;
    }
    const row = db
      .prepare('SELECT mfa_secret_encrypted FROM users WHERE id = ?')
      .get(req.auth!.userId) as { mfa_secret_encrypted: string | null } | undefined;

    if (!row?.mfa_secret_encrypted) {
      res.status(400).json({ error: 'Run MFA setup before enabling' });
      return;
    }
    const secret = decryptField(row.mfa_secret_encrypted);
    if (!verifyTotpCode(secret, code)) {
      res.status(400).json({ error: 'Invalid verification code' });
      return;
    }

    const backupCodes = generateBackupCodes(6);
    const hashedBackups = backupCodes.map((c) => sha256(c));

    db.prepare(
      'UPDATE users SET mfa_enabled = 1, mfa_backup_codes_hash = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(hashedBackups), new Date().toISOString(), req.auth!.userId);

    writeAuditLog(db, {
      organizationId: req.auth!.organizationId,
      actorUserId: req.auth!.userId,
      action: 'MFA_ENABLED',
      resourceType: 'User',
      resourceId: req.auth!.userId,
      ipAddress: req.ip,
    });

    res.json({ enabled: true, backupCodes });
  });

  router.post('/mfa/disable', requireAuth, (req, res) => {
    const { password } = req.body as { password?: string };
    if (!password) {
      res.status(400).json({ error: 'Current password is required to disable MFA' });
      return;
    }
    const row = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(req.auth!.userId) as { password_hash: string } | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Incorrect password' });
      return;
    }

    db.prepare(
      'UPDATE users SET mfa_enabled = 0, mfa_secret_encrypted = NULL, mfa_backup_codes_hash = NULL, updated_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), req.auth!.userId);

    writeAuditLog(db, {
      organizationId: req.auth!.organizationId,
      actorUserId: req.auth!.userId,
      action: 'MFA_DISABLED',
      resourceType: 'User',
      resourceId: req.auth!.userId,
      ipAddress: req.ip,
    });

    res.json({ disabled: true });
  });

  return router;
}
