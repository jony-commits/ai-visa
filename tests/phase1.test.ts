import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApiApp } from '../server/app.ts';
import { openDatabase, type AppDatabase } from '../server/db.ts';
import { generateTotpCode } from '../server/mfa.ts';
import { DEMO_PASSWORD, seedDatabase } from '../server/seed.ts';

let db: AppDatabase;
let server: http.Server;
let baseUrl: string;

async function api(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; data: Record<string, any> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as Record<string, any>;
  return { status: res.status, data };
}

before(async () => {
  db = openDatabase(':memory:');
  seedDatabase(db);
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

describe('Phase 1 — Auth, Encryption, Multi-Tenant Isolation, RBAC & Workflow Engine', () => {
  it('registers a new applicant, verifies email, and records encrypted passport & consent', async () => {
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'new.applicant@example.org',
        password: 'StrongPassword!2026',
        fullName: 'Nadia Lindqvist',
        accountType: 'APPLICANT',
        organizationId: 'org_apex',
      },
    });
    assert.equal(reg.status, 201);
    assert.ok(reg.data.token);
    assert.ok(reg.data.verificationTokenPreview);

    const verify = await api('/api/auth/verify-email', {
      method: 'POST',
      body: { token: reg.data.verificationTokenPreview },
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.data.verified, true);

    const rawPassport = 'SE9948271';
    const profileSave = await api('/api/applicant/profile', {
      method: 'PUT',
      token: reg.data.token,
      body: {
        fullLegalName: 'Nadia Lindqvist',
        dateOfBirth: '1991-05-12',
        nationality: 'DE',
        residenceCountry: 'US',
        phone: '+1-212-555-0199',
        travelDestination: 'CA',
        visaCategory: 'STUDENT',
        intendedTravelStart: '2027-08-15',
        intendedTravelEnd: '2029-05-30',
        purposeOfTravel: 'Graduate engineering degree',
        passport: {
          passportNumber: rawPassport,
          issuingCountry: 'DE',
          issueDate: '2023-01-10',
          expiryDate: '2033-01-09',
        },
        consents: {
          PERSONAL_DATA_PROCESSING: true,
          EXTERNAL_AI_PROCESSING: false,
          COMMUNICATIONS: true,
        },
      },
    });
    assert.equal(profileSave.status, 200);
    assert.equal(profileSave.data.passport.passport_number_masked, '•••••8271');

    // Verify passport number is NOT stored in plaintext inside SQLite
    const dbRow = db
      .prepare('SELECT passport_number_encrypted FROM passport_records WHERE id = ?')
      .get(profileSave.data.passport.id) as { passport_number_encrypted: string };
    assert.ok(!dbRow.passport_number_encrypted.includes(rawPassport));
  });

  it('enforces TOTP MFA setup and challenge verification on login', async () => {
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'new.applicant@example.org', password: 'StrongPassword!2026' },
    });
    assert.equal(login.status, 200);
    const token = login.data.token;

    const setup = await api('/api/auth/mfa/setup', { method: 'POST', token });
    assert.equal(setup.status, 200);
    const code = generateTotpCode(setup.data.secret);

    const enable = await api('/api/auth/mfa/enable', {
      method: 'POST',
      token,
      body: { code },
    });
    assert.equal(enable.status, 200);
    assert.equal(enable.data.enabled, true);

    const challengeLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'new.applicant@example.org', password: 'StrongPassword!2026' },
    });
    assert.equal(challengeLogin.status, 200);
    assert.equal(challengeLogin.data.mfaRequired, true);
    assert.ok(challengeLogin.data.mfaChallengeToken);

    const verifyMfa = await api('/api/auth/mfa/verify-login', {
      method: 'POST',
      body: {
        mfaChallengeToken: challengeLogin.data.mfaChallengeToken,
        code: generateTotpCode(setup.data.secret),
      },
    });
    assert.equal(verifyMfa.status, 200);
    assert.ok(verifyMfa.data.token);
  });

  it('enforces strict multi-tenant isolation between Apex Global Mobility and Pacific Rim Immigration', async () => {
    const apexConsultant = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'consultant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const pacificConsultant = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'consultant@pacificrim.demo', password: DEMO_PASSWORD },
    });

    const apexList = await api('/api/cases', { token: apexConsultant.data.token });
    assert.equal(apexList.status, 200);
    assert.ok(apexList.data.cases.every((c: any) => c.organization_id === 'org_apex'));
    assert.ok(!apexList.data.cases.some((c: any) => c.id === 'app_pacific_1'));

    // Cross-tenant case read must return 403
    const crossRead = await api('/api/cases/app_pacific_1', {
      token: apexConsultant.data.token,
    });
    assert.equal(crossRead.status, 403);

    // Cross-tenant transition must return 403
    const crossTransition = await api('/api/cases/app_apex_1/transition', {
      method: 'PATCH',
      token: pacificConsultant.data.token,
      body: { toStatus: 'DOCUMENT_VERIFICATION' },
    });
    assert.equal(crossTransition.status, 403);
  });

  it('enforces RBAC, hides internal notes from applicants, and blocks invalid workflow jumps', async () => {
    const applicant = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const admin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@apexmobility.demo', password: DEMO_PASSWORD },
    });

    // Applicant cannot see INTERNAL consultant notes
    const caseDetail = await api('/api/cases/app_apex_1', {
      token: applicant.data.token,
    });
    assert.equal(caseDetail.status, 200);
    assert.ok(caseDetail.data.notes.every((n: any) => n.visibility === 'APPLICANT_VISIBLE'));

    // Applicant cannot assign consultants
    const forbiddenAssign = await api('/api/cases/app_apex_1/assign', {
      method: 'PATCH',
      token: applicant.data.token,
      body: { consultantUserId: 'usr_consultant_apex' },
    });
    assert.equal(forbiddenAssign.status, 403);

    // Applicant cannot unilaterally jump a case directly to APPROVED
    const invalidJump = await api('/api/cases/app_apex_1/transition', {
      method: 'PATCH',
      token: applicant.data.token,
      body: { toStatus: 'APPROVED' },
    });
    assert.equal(invalidJump.status, 400);

    // Admin cannot assign a consultant from another tenant
    const crossTenantAssign = await api('/api/cases/app_apex_1/assign', {
      method: 'PATCH',
      token: admin.data.token,
      body: { consultantUserId: 'usr_consultant_pacific' },
    });
    assert.equal(crossTenantAssign.status, 400);

    // Consultant cannot fabricate OFFICIAL_API source via manual endpoint
    const consultant = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'consultant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const fakeSource = await api('/api/cases/app_apex_1/government-status', {
      method: 'PATCH',
      token: consultant.data.token,
      body: {
        governmentStatus: 'APPROVED',
        governmentStatusSource: 'OFFICIAL_API',
      },
    });
    assert.equal(fakeSource.status, 400);
  });
});
