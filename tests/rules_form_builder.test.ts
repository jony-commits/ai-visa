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

describe('Country-Specific Visa Rule Engine & Dynamic Form Builder', () => {
  it('enforces DRAFT -> IN_REVIEW -> PUBLISHED rule governance, officialSourceUrl provenance, and drives dynamic checklists', async () => {
    const adminApexToken = await login('admin@apexmobility.demo');
    const officerApexToken = await login('officer@apexmobility.demo');
    const applicantApexToken = await login('applicant@apexmobility.demo');
    const consultantPacificToken = await login('consultant@pacificrim.demo');

    // Applicant cannot author rules
    const forbiddenCreate = await api('/api/rules/routes', {
      method: 'POST',
      token: applicantApexToken,
      body: {
        destinationCountry: 'SG',
        visaCategoryCode: 'WORK',
        title: 'Unauthorized Rule',
        ruleVersion: '1.0',
        summary: 'Attempted unauthorized rule creation by applicant.',
        requirements: [
          {
            requirementCode: 'PASSPORT_BIO_PAGE',
            title: 'Passport',
            documentType: 'PASSPORT',
            isMandatory: true,
            conditionType: 'ALWAYS',
          },
        ],
      },
    });
    assert.equal(forbiddenCreate.status, 403);

    // Agency Admin creates an official (non-demo) rule in DRAFT without officialSourceUrl
    const createDraft = await api('/api/rules/routes', {
      method: 'POST',
      token: adminApexToken,
      body: {
        destinationCountry: 'SG',
        visaCategoryCode: 'WORK',
        title: 'Singapore Employment Pass (EP Specialist)',
        ruleVersion: '2026.4-apex',
        effectiveFrom: '2026-06-01',
        summary: 'Employer-sponsored qualified specialist work route for Singapore.',
        isDemoRule: false,
        requirements: [
          {
            requirementCode: 'PASSPORT_BIO_PAGE',
            title: 'Valid Passport Biographical Page',
            documentType: 'PASSPORT',
            isMandatory: true,
            conditionType: 'ALWAYS',
          },
          {
            requirementCode: 'SG_WORK_CONTRACT',
            title: 'MOM In-Principle Approval & Employment Contract',
            documentType: 'EMPLOYMENT_LETTER',
            isMandatory: true,
            conditionType: 'ALWAYS',
          },
          {
            requirementCode: 'LONG_STAY_LEASE',
            title: 'Long-Stay Singapore Lease Agreement',
            documentType: 'TRAVEL_ITINERARY',
            isMandatory: true,
            conditionType: 'STAY_OVER_30_DAYS',
          },
        ],
      },
    });
    assert.equal(createDraft.status, 201);
    const routeId = createDraft.data.route.id as string;
    assert.equal(createDraft.data.route.approval_status, 'DRAFT');

    // Draft rule must NOT appear in published catalog yet
    const catalogBefore = await api('/api/catalog/routes', { token: applicantApexToken });
    assert.equal(
      catalogBefore.data.routes.some((r: any) => r.id === routeId),
      false,
    );

    // Move DRAFT -> IN_REVIEW
    const toReview = await api(`/api/rules/routes/${routeId}/transition`, {
      method: 'POST',
      token: adminApexToken,
      body: { targetStatus: 'IN_REVIEW' },
    });
    assert.equal(toReview.status, 200);
    assert.equal(toReview.data.route.approval_status, 'IN_REVIEW');

    // Trying to publish non-demo rule without officialSourceUrl must fail
    const failPublish = await api(`/api/rules/routes/${routeId}/transition`, {
      method: 'POST',
      token: officerApexToken,
      body: { targetStatus: 'PUBLISHED' },
    });
    assert.equal(failPublish.status, 400);

    // Edit rule in IN_REVIEW to supply verified officialSourceUrl
    const updateUrl = await api(`/api/rules/routes/${routeId}`, {
      method: 'PUT',
      token: adminApexToken,
      body: {
        officialSourceUrl: 'https://www.mom.gov.sg/passes-and-permits/employment-pass',
      },
    });
    assert.equal(updateUrl.status, 200);

    // Verification Officer approves & publishes
    const publishRes = await api(`/api/rules/routes/${routeId}/transition`, {
      method: 'POST',
      token: officerApexToken,
      body: { targetStatus: 'PUBLISHED' },
    });
    assert.equal(publishRes.status, 200);
    assert.equal(publishRes.data.route.approval_status, 'PUBLISHED');
    assert.ok(publishRes.data.route.source_verified_at);

    // Direct edits to PUBLISHED rules are rejected
    const editPublished = await api(`/api/rules/routes/${routeId}`, {
      method: 'PUT',
      token: adminApexToken,
      body: { title: 'Mutated Published Rule' },
    });
    assert.equal(editPublished.status, 400);

    // Pacific Rim tenant cannot see Apex's custom rule
    const pacificCatalog = await api('/api/catalog/routes', { token: consultantPacificToken });
    assert.equal(
      pacificCatalog.data.routes.some((r: any) => r.id === routeId),
      false,
    );

    // Rule simulator evaluates both ALWAYS and STAY_OVER_30_DAYS conditions
    const simShort = await api('/api/rules/evaluate-preview', {
      method: 'POST',
      token: adminApexToken,
      body: {
        destinationCountry: 'SG',
        visaCategory: 'WORK',
        travelDurationDays: 20,
        hasDependents: false,
      },
    });
    assert.equal(simShort.status, 200);
    assert.equal(simShort.data.ruleSource, 'CUSTOM_RULE_DEFINITION');
    assert.equal(simShort.data.requirements.length, 2);

    const simLong = await api('/api/rules/evaluate-preview', {
      method: 'POST',
      token: adminApexToken,
      body: {
        destinationCountry: 'SG',
        visaCategory: 'WORK',
        travelDurationDays: 90,
        hasDependents: false,
      },
    });
    assert.equal(simLong.status, 200);
    assert.equal(simLong.data.requirements.length, 3);
    assert.equal(
      simLong.data.requirements.some((r: any) => r.requirementCode === 'LONG_STAY_LEASE'),
      true,
    );

    // New case for SG / WORK automatically uses published custom rule & dynamic checklist
    const createdCase = await api('/api/cases', {
      method: 'POST',
      token: applicantApexToken,
      body: {
        destinationCountry: 'SG',
        visaCategory: 'WORK',
        originCountry: 'IN',
        nationality: 'IN',
        intendedTravelDate: '2027-03-01',
        purposeOfTravel: 'Engineering transfer to Singapore office',
      },
    });
    assert.equal(createdCase.status, 201);
    const caseId = createdCase.data.application.id as string;

    const checklist = await api(`/api/cases/${caseId}/checklist`, { token: applicantApexToken });
    assert.equal(checklist.status, 200);
    assert.equal(
      checklist.data.requirements.some(
        (r: any) => r.requirement_code === 'SG_WORK_CONTRACT',
      ),
      true,
    );
  });

  it('authors, versions, publishes, and resolves custom Dynamic Visa Form Schemas with strict tenant isolation', async () => {
    const adminApexToken = await login('admin@apexmobility.demo');
    const officerApexToken = await login('officer@apexmobility.demo');
    const applicantApexToken = await login('applicant@apexmobility.demo');
    const consultantPacificToken = await login('consultant@pacificrim.demo');

    // Create custom SG WORK dynamic form schema in Apex tenant
    const createSchema = await api('/api/rules/form-schemas', {
      method: 'POST',
      token: adminApexToken,
      body: {
        schemaKey: 'sg-work-ep',
        version: '2026.4-apex',
        title: 'Singapore Employment Pass — Custom Form',
        destinationCountry: 'SG',
        visaCategoryCode: 'WORK',
        isDemoRule: true,
        steps: [
          { id: 'identity', title: 'Passport Identity', description: 'Core bio data', order: 0 },
          { id: 'sg_employer', title: 'Singapore Host Employer', description: 'UEN & contract', order: 1 },
        ],
        properties: {
          fullLegalName: {
            type: 'string',
            title: 'Full Legal Name',
            stepId: 'identity',
            required: true,
          },
          uenNumber: {
            type: 'string',
            title: 'Singapore Employer UEN Number',
            minLength: 8,
            stepId: 'sg_employer',
            required: true,
          },
          arrivalDate: {
            type: 'date',
            title: 'Planned Singapore Entry Date',
            stepId: 'sg_employer',
            required: true,
          },
          purposeSummary: {
            type: 'string',
            title: 'Role & Assignment Rationale',
            format: 'textarea',
            stepId: 'sg_employer',
            required: true,
            aiSuggestible: true,
          },
        },
      },
    });
    assert.equal(createSchema.status, 201);
    const schemaId = createSchema.data.schemaId as string;

    // Cross-tenant staff cannot edit or transition Apex's draft schema
    const crossTenantEdit = await api(`/api/rules/form-schemas/${schemaId}`, {
      method: 'PUT',
      token: consultantPacificToken,
      body: { title: 'Hijacked Schema' },
    });
    assert.equal(crossTenantEdit.status, 403);

    // Submit & publish form schema in Apex tenant
    assert.equal(
      (
        await api(`/api/rules/form-schemas/${schemaId}/transition`, {
          method: 'POST',
          token: adminApexToken,
          body: { targetStatus: 'IN_REVIEW' },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api(`/api/rules/form-schemas/${schemaId}/transition`, {
          method: 'POST',
          token: officerApexToken,
          body: { targetStatus: 'PUBLISHED' },
        })
      ).status,
      200,
    );

    // Apex SG WORK case resolves the newly published custom dynamic form schema
    const apexSgCase = await api('/api/cases', {
      method: 'POST',
      token: applicantApexToken,
      body: {
        destinationCountry: 'SG',
        visaCategory: 'WORK',
        originCountry: 'IN',
        nationality: 'IN',
        intendedTravelDate: '2027-04-10',
        purposeOfTravel: 'Principal architect relocation',
      },
    });
    assert.equal(apexSgCase.status, 201);

    const apexForm = await api(`/api/cases/${apexSgCase.data.application.id}/forms`, {
      token: applicantApexToken,
    });
    assert.equal(apexForm.status, 200);
    assert.equal(apexForm.data.schema.schemaKey, 'sg-work-ep');
    assert.ok(apexForm.data.schema.properties.uenNumber);

    // Pacific Rim SG WORK case must still fall back to universal schema, NOT Apex's custom tenant schema
    const pacificSgCase = await api('/api/cases', {
      method: 'POST',
      token: consultantPacificToken,
      body: {
        destinationCountry: 'SG',
        visaCategory: 'WORK',
        originCountry: 'CA',
        nationality: 'CA',
        intendedTravelDate: '2027-04-10',
        purposeOfTravel: 'Partner consultation in Singapore',
      },
    });
    assert.equal(pacificSgCase.status, 201);

    const pacificForm = await api(`/api/cases/${pacificSgCase.data.application.id}/forms`, {
      token: consultantPacificToken,
    });
    assert.equal(pacificForm.status, 200);
    assert.equal(pacificForm.data.schema.schemaKey, 'intl-visa-universal');
  });
});
