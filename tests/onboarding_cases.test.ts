import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApiApp } from '../server/app.ts';
import { openDatabase, type AppDatabase } from '../server/db.ts';
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

describe('Applicant Onboarding & Visa Case Management — Validation, Authorization & Tenant Isolation', () => {
  it('rejects unauthenticated access to onboarding and case endpoints with 401', async () => {
    const profileRes = await api('/api/applicant/profile');
    assert.equal(profileRes.status, 401);

    const casesRes = await api('/api/cases');
    assert.equal(casesRes.status, 401);

    const createRes = await api('/api/cases', {
      method: 'POST',
      body: { destinationCountry: 'JP', visaCategory: 'WORK', originCountry: 'US', nationality: 'IN' },
    });
    assert.equal(createRes.status, 401);
  });

  it('enforces server-side validation on applicant onboarding and passport records', async () => {
    const applicant2 = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant2@apexmobility.demo', password: DEMO_PASSWORD },
    });
    assert.equal(applicant2.status, 200);
    const token = applicant2.data.token;

    // Invalid DOB in future, invalid passport expiry <= issueDate, revoked required consent
    const badProfile = await api('/api/applicant/profile', {
      method: 'PUT',
      token,
      body: {
        fullLegalName: 'Priya Nair',
        dateOfBirth: '2099-01-01',
        nationality: 'IN',
        residenceCountry: 'IN',
        phone: '+91-98200-11223',
        travelDestination: 'ZZ',
        visaCategory: 'INVALID_CAT',
        passport: {
          passportNumber: '12',
          issuingCountry: 'IN',
          issueDate: '2025-05-01',
          expiryDate: '2024-05-01',
        },
        consents: {
          PERSONAL_DATA_PROCESSING: false,
        },
      },
    });
    assert.equal(badProfile.status, 400);
    assert.ok(badProfile.data.fieldErrors.dateOfBirth);
    assert.ok(badProfile.data.fieldErrors.travelDestination);
    assert.ok(badProfile.data.fieldErrors.visaCategory);
    assert.ok(badProfile.data.fieldErrors['passport.expiryDate']);
    assert.ok(badProfile.data.fieldErrors['passport.passportNumber']);
    assert.ok(badProfile.data.fieldErrors['consents.PERSONAL_DATA_PROCESSING']);

    // Valid onboarding save succeeds and populates onboardingChecklist
    const validSave = await api('/api/applicant/profile', {
      method: 'PUT',
      token,
      body: {
        fullLegalName: 'Priya Nair',
        dateOfBirth: '1997-09-20',
        nationality: 'IN',
        residenceCountry: 'IN',
        phone: '+91-98200-11223',
        travelDestination: 'CA',
        visaCategory: 'STUDENT',
        intendedTravelStart: '2027-08-20',
        intendedTravelEnd: '2029-05-15',
        purposeOfTravel: 'Masters in Computer Science',
        dependents: [],
        passport: {
          passportNumber: 'K8821940',
          issuingCountry: 'IN',
          issueDate: '2021-06-01',
          expiryDate: '2031-05-31',
        },
        consents: {
          PERSONAL_DATA_PROCESSING: true,
          EXTERNAL_AI_PROCESSING: true,
          COMMUNICATIONS: true,
        },
      },
    });
    assert.equal(validSave.status, 200);
    assert.equal(validSave.data.passport.passport_number_masked, '••••1940');

    const fetched = await api('/api/applicant/profile', { token });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.data.onboardingChecklist.identity, true);
    assert.equal(fetched.data.onboardingChecklist.passport, true);
    assert.equal(fetched.data.onboardingChecklist.travel, true);
    assert.equal(fetched.data.onboardingChecklist.consent, true);
  });

  it('supports country & category selection, staff case creation, assignment RBAC, and same-tenant applicant isolation', async () => {
    const admin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const consultant = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'consultant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const applicant1 = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const applicant2 = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant2@apexmobility.demo', password: DEMO_PASSWORD },
    });

    // Applicant 1 cannot view Applicant 2's case inside the SAME agency (org_apex)
    const app1Cases = await api('/api/cases', { token: applicant1.data.token });
    assert.equal(app1Cases.status, 200);
    assert.ok(!app1Cases.data.cases.some((c: any) => c.id === 'app_apex_3'));

    const app1ReadsApp2 = await api('/api/cases/app_apex_3', { token: applicant1.data.token });
    assert.equal(app1ReadsApp2.status, 403);

    // Applicant cannot create a case on behalf of another user
    const spoofedCreate = await api('/api/cases', {
      method: 'POST',
      token: applicant1.data.token,
      body: {
        destinationCountry: 'JP',
        visaCategory: 'WORK',
        originCountry: 'US',
        nationality: 'IN',
        applicantUserId: 'usr_applicant2_apex',
      },
    });
    assert.equal(spoofedCreate.status, 403);

    // Agency Admin creates a JP WORK case for Applicant 2 and assigns Consultant Elena
    const adminCreate = await api('/api/cases', {
      method: 'POST',
      token: admin.data.token,
      body: {
        destinationCountry: 'JP',
        visaCategory: 'WORK',
        originCountry: 'IN',
        nationality: 'IN',
        intendedTravelDate: '2027-10-01',
        purposeOfTravel: 'Software engineering transfer to Tokyo office',
        applicantUserId: 'usr_applicant2_apex',
        assignedConsultantId: 'usr_consultant_apex',
      },
    });
    assert.equal(adminCreate.status, 201);
    assert.equal(adminCreate.data.application.destination_country, 'JP');
    assert.equal(adminCreate.data.application.visa_category, 'WORK');
    assert.equal(adminCreate.data.application.applicant_user_id, 'usr_applicant2_apex');
    assert.equal(adminCreate.data.application.assigned_consultant_id, 'usr_consultant_apex');
    const createdCaseId = adminCreate.data.application.id;

    // Consultant cannot reassign cases (ADMIN only)
    const consultantAssign = await api(`/api/cases/${createdCaseId}/assign`, {
      method: 'PATCH',
      token: consultant.data.token,
      body: { consultantUserId: 'usr_officer_apex' },
    });
    assert.equal(consultantAssign.status, 403);

    // Admin cannot assign an APPLICANT role user as the case consultant
    const assignApplicant = await api(`/api/cases/${createdCaseId}/assign`, {
      method: 'PATCH',
      token: admin.data.token,
      body: { consultantUserId: 'usr_applicant_apex' },
    });
    assert.equal(assignApplicant.status, 400);

    // Admin can unassign and then reassign to Verification Officer
    const unassign = await api(`/api/cases/${createdCaseId}/assign`, {
      method: 'PATCH',
      token: admin.data.token,
      body: { consultantUserId: null },
    });
    assert.equal(unassign.status, 200);
    assert.equal(unassign.data.consultantUserId, null);

    const reassign = await api(`/api/cases/${createdCaseId}/assign`, {
      method: 'PATCH',
      token: admin.data.token,
      body: { consultantUserId: 'usr_officer_apex' },
    });
    assert.equal(reassign.status, 200);
    assert.equal(reassign.data.consultantUserId, 'usr_officer_apex');

    // Applicant 2 can see the newly created JP WORK case
    const app2Cases = await api('/api/cases', { token: applicant2.data.token });
    assert.ok(app2Cases.data.cases.some((c: any) => c.id === createdCaseId));
  });
});
