import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApiApp } from '../server/app.ts';
import { newId, openDatabase, type AppDatabase } from '../server/db.ts';
import { DEMO_PASSWORD, seedDatabase } from '../server/seed.ts';

let db: AppDatabase;
let server: http.Server;
let baseUrl: string;

async function api(
  urlPath: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; data: Record<string, any> }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data };
}

async function login(email: string): Promise<string> {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: DEMO_PASSWORD },
  });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return res.data.token as string;
}

before(async () => {
  db = openDatabase(':memory:');
  seedDatabase(db);

  // Seed an overdue SLA case and AI usage log entries to verify telemetry aggregation & tenant isolation
  const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE visa_applications SET stage_due_at = ? WHERE id = 'app_apex_2'`).run(pastDue);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_usage_logs (
      id, organization_id, user_id, application_id, document_id,
      provider, model, prompt_version, input_tokens, output_tokens, status, created_at
    ) VALUES (?, ?, ?, ?, NULL, 'GEMINI', 'gemini-2.5-flash', 'extract-v1', 1200, 450, 'SUCCESS', ?)
  `).run(newId('ai'), 'org_apex', 'usr_consultant_apex', 'app_apex_1', now);

  db.prepare(`
    INSERT INTO ai_usage_logs (
      id, organization_id, user_id, application_id, document_id,
      provider, model, prompt_version, input_tokens, output_tokens, status, created_at
    ) VALUES (?, ?, ?, ?, NULL, 'GEMINI', 'gemini-2.5-flash', 'suggest-v1', 800, 0, 'FAILED', ?)
  `).run(newId('ai'), 'org_pacific', 'usr_consultant_pacific', 'app_pacific_1', now);

  const app = createApiApp(db);
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (db) {
    db.close();
  }
});

describe('Phase 6: Role Analytics, AI Usage Telemetry, Super Admin Console & Audit Filtering', () => {
  it('scopes analytics overview per role and blocks applicant cross-case visibility', async () => {
    const applicantToken = await login('applicant@apexmobility.demo');
    const consultantToken = await login('consultant@apexmobility.demo');
    const pacificToken = await login('consultant@pacificrim.demo');
    const superToken = await login('superadmin@meridianvisa.demo');

    // Applicant only sees own 2 cases even if asking for scope=platform
    const applicantOverview = await api('/api/analytics/overview?scope=platform', {
      token: applicantToken,
    });
    assert.equal(applicantOverview.status, 200);
    assert.equal(applicantOverview.data.scope, 'tenant');
    assert.equal(applicantOverview.data.summary.totalCases, 2);
    assert.ok(applicantOverview.data.applicantSummary);
    assert.equal(applicantOverview.data.applicantSummary.onboardingCompleted, true);
    assert.equal(applicantOverview.data.consultantWorkload.length, 0);

    // Consultant sees Apex Mobility tenant (3 cases, 1 overdue SLA, workload breakdown)
    const consultantOverview = await api('/api/analytics/overview?scope=platform', {
      token: consultantToken,
    });
    assert.equal(consultantOverview.status, 200);
    assert.equal(consultantOverview.data.scope, 'tenant');
    assert.equal(consultantOverview.data.summary.totalCases, 3);
    assert.equal(consultantOverview.data.summary.overdueSlaCount, 1);
    assert.ok(consultantOverview.data.consultantWorkload.length >= 3);

    // Pacific consultant sees strictly Pacific Rim (1 case, 0 overdue)
    const pacificOverview = await api('/api/analytics/overview', {
      token: pacificToken,
    });
    assert.equal(pacificOverview.status, 200);
    assert.equal(pacificOverview.data.summary.totalCases, 1);
    assert.equal(pacificOverview.data.summary.overdueSlaCount, 0);

    // Super Admin can toggle between platform scope (4 cases across 2 tenants) and active tenant
    const superPlatform = await api('/api/analytics/overview?scope=platform', {
      token: superToken,
    });
    assert.equal(superPlatform.status, 200);
    assert.equal(superPlatform.data.scope, 'platform');
    assert.equal(superPlatform.data.summary.totalCases, 4);

    const superTenant = await api('/api/analytics/overview?scope=tenant', {
      token: superToken,
    });
    assert.equal(superTenant.status, 200);
    assert.equal(superTenant.data.scope, 'tenant');
    assert.equal(superTenant.data.summary.totalCases, 3);
  });

  it('enforces RBAC & tenant isolation on /api/analytics/ai-usage and /api/admin/tenants', async () => {
    const applicantToken = await login('applicant@apexmobility.demo');
    const consultantToken = await login('consultant@apexmobility.demo');
    const pacificToken = await login('consultant@pacificrim.demo');
    const superToken = await login('superadmin@meridianvisa.demo');

    // Applicant cannot access AI usage analytics
    const applicantAi = await api('/api/analytics/ai-usage', { token: applicantToken });
    assert.equal(applicantAi.status, 403);

    // Apex staff only sees Apex AI calls (1 call, 1650 tokens) even if requesting platform scope
    const apexAi = await api('/api/analytics/ai-usage?scope=platform', {
      token: consultantToken,
    });
    assert.equal(apexAi.status, 200);
    assert.equal(apexAi.data.scope, 'tenant');
    assert.equal(apexAi.data.totals.totalCalls, 1);
    assert.equal(apexAi.data.totals.totalTokens, 1650);

    // Pacific consultant only sees Pacific AI calls (1 failed call, 800 tokens)
    const pacificAi = await api('/api/analytics/ai-usage', { token: pacificToken });
    assert.equal(pacificAi.status, 200);
    assert.equal(pacificAi.data.totals.totalCalls, 1);
    assert.equal(pacificAi.data.totals.failedCount, 1);
    assert.equal(pacificAi.data.totals.totalTokens, 800);

    // Super Admin platform scope sees both organizations combined
    const superAi = await api('/api/analytics/ai-usage?scope=platform', { token: superToken });
    assert.equal(superAi.status, 200);
    assert.equal(superAi.data.scope, 'platform');
    assert.equal(superAi.data.totals.totalCalls, 2);
    assert.equal(superAi.data.totals.totalTokens, 2450);
    assert.equal(superAi.data.byOrganization.length, 2);

    // Enriched Super Admin /api/admin/tenants metrics
    const adminTenants = await api('/api/admin/tenants', { token: superToken });
    assert.equal(adminTenants.status, 200);
    assert.equal(adminTenants.data.tenants.length, 2);
    const apexTenant = adminTenants.data.tenants.find((t: any) => t.id === 'org_apex');
    assert.equal(apexTenant.overdue_cases_count, 1);
    assert.equal(apexTenant.ai_total_tokens, 1650);
    assert.ok(adminTenants.data.ruleSummary.routes_count >= 3);
  });

  it('filters /api/audit-logs by resourceType and search while preserving tenant isolation', async () => {
    const adminToken = await login('admin@apexmobility.demo');
    const consultantToken = await login('consultant@apexmobility.demo');
    const pacificToken = await login('consultant@pacificrim.demo');

    // Non-admin/non-officer cannot view audit logs
    const consultantAudit = await api('/api/audit-logs', { token: consultantToken });
    assert.equal(consultantAudit.status, 403);
    const pacificAudit = await api('/api/audit-logs', { token: pacificToken });
    assert.equal(pacificAudit.status, 403);

    // Trigger an auditable role/case event for search verification
    const filteredRes = await api(
      '/api/audit-logs?resourceType=Organization&search=SEED_INITIALIZED&limit=25',
      { token: adminToken },
    );
    assert.equal(filteredRes.status, 200);
    assert.ok(filteredRes.data.logs.length >= 1);
    assert.ok(
      filteredRes.data.logs.every(
        (log: any) =>
          log.organization_id === 'org_apex' && log.resource_type === 'Organization',
      ),
    );
  });
});
