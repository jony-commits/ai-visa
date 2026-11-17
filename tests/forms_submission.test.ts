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

describe('Dynamic AI-Assisted Visa Form System & Submission Handoff', () => {
  it('resolves versioned country schemas, prefills verified records, auto-saves, and enforces conditional field validation', async () => {
    const applicantLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    assert.equal(applicantLogin.status, 200);
    const token = applicantLogin.data.token;

    // 1. Catalog exposes versioned schemas
    const schemasRes = await api('/api/form-schemas', { token });
    assert.equal(schemasRes.status, 200);
    assert.ok(schemasRes.data.schemas.some((s: any) => s.schema_key === 'de-schengen-tourist'));
    assert.ok(schemasRes.data.schemas.some((s: any) => s.schema_key === 'gb-standard-business'));

    // 2. DE:TOURIST case resolves de-schengen-tourist 2026.1-demo schema
    const formRes = await api('/api/cases/app_apex_1/forms', { token });
    assert.equal(formRes.status, 200);
    assert.equal(formRes.data.schema.schemaKey, 'de-schengen-tourist');
    assert.equal(formRes.data.schema.version, '2026.1-demo');
    assert.equal(formRes.data.schema.isDemoRule, true);

    // 3. Verified prefill maps profile & decrypted passport without touching raw OCR
    const prefillRes = await api('/api/cases/app_apex_1/forms/prefill', {
      method: 'POST',
      token,
      body: {},
    });
    assert.equal(prefillRes.status, 200);
    const filled = prefillRes.data.detail.form;
    assert.equal(filled.answers.fullLegalName, 'Aarav Mehta');
    assert.equal(filled.answers.passportNumber, 'Z9482714');
    assert.equal(filled.sourceAttribution.fullLegalName, 'VERIFIED_PROFILE');
    assert.equal(filled.sourceAttribution.passportNumber, 'VERIFIED_PASSPORT_RECORD');

    // 4. Auto-save conditional answers and verify server rejects missing conditional fields on approval
    const autosaveRes = await api('/api/cases/app_apex_1/forms/draft', {
      method: 'PUT',
      token,
      body: {
        isAutosave: true,
        currentStep: 1,
        answers: {
          accommodationType: 'HOST_FAMILY',
          hasPriorSchengenVisa: true,
          fundingSource: 'SELF_FUNDED',
          employmentStatus: 'EMPLOYED',
        },
      },
    });
    assert.equal(autosaveRes.status, 200);
    assert.ok(autosaveRes.data.detail.form.lastAutosavedAt);

    // Try approving while conditional fields (hostFullName, hostAddressInGermany, priorSchengenVisaReference, employerName, monthlyNetIncomeUsd, narratives) are missing
    const prematureApprove = await api('/api/cases/app_apex_1/forms/approve', {
      method: 'POST',
      token,
      body: { attestationAccepted: true },
    });
    assert.equal(prematureApprove.status, 400);
    const errKeys = (prematureApprove.data.fieldErrors || []).map((e: any) => e.fieldKey);
    assert.ok(errKeys.includes('hostFullName'));
    assert.ok(errKeys.includes('hostAddressInGermany'));
    assert.ok(errKeys.includes('priorSchengenVisaReference'));
    assert.ok(errKeys.includes('employerName'));
  });

  it('gates AI suggestions by consent, requires explicit human review before approval, resets approval on edit, and supports export', async () => {
    const applicant1Login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const applicant2Login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant2@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const consultantLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'consultant@apexmobility.demo', password: DEMO_PASSWORD },
    });

    const token1 = applicant1Login.data.token;
    const token2 = applicant2Login.data.token;
    const consultantToken = consultantLogin.data.token;

    // Applicant2 (Priya Nair) has NOT granted EXTERNAL_AI_PROCESSING consent -> blocked 403
    const blockedAi = await api('/api/cases/app_apex_3/forms/ai-suggest', {
      method: 'POST',
      token: token2,
    });
    assert.equal(blockedAi.status, 403);
    assert.match(blockedAi.data.error, /EXTERNAL_AI_PROCESSING/i);

    // Applicant1 HAS consent -> AI suggestions generated as PENDING_REVIEW and NOT yet copied into answers
    const aiRes = await api('/api/cases/app_apex_1/forms/ai-suggest', {
      method: 'POST',
      token: token1,
    });
    assert.equal(aiRes.status, 200);
    const pendingSuggestions = aiRes.data.form.aiSuggestions;
    assert.equal(pendingSuggestions.purposeSummary.status, 'PENDING_REVIEW');
    assert.equal(pendingSuggestions.purposeSummary.reviewRequired, true);
    assert.equal(aiRes.data.form.answers.purposeSummary, undefined);

    // Fill remaining conditional non-AI fields explicitly
    await api('/api/cases/app_apex_1/forms/draft', {
      method: 'PUT',
      token: token1,
      body: {
        currentStep: 2,
        answers: {
          accommodationType: 'HOTEL',
          hotelNameAndBookingRef: 'Hotel Maximilian Munich — BK-9021',
          hasPriorSchengenVisa: false,
          employerName: 'Northstar Systems Inc.',
          monthlyNetIncomeUsd: 7800,
        },
        changeReason: 'Completed hotel and employer fields',
      },
    });

    // Approval must STILL fail while AI suggestions remain PENDING_REVIEW
    const blockedWhileUnreviewed = await api('/api/cases/app_apex_1/forms/approve', {
      method: 'POST',
      token: token1,
      body: { attestationAccepted: true },
    });
    assert.equal(blockedWhileUnreviewed.status, 400);
    assert.match(blockedWhileUnreviewed.data.error, /pending AI suggestions/i);

    // Review & accept all three AI draft suggestions
    for (const key of ['purposeSummary', 'financialSupportExplanation', 'homeCountryTiesSummary']) {
      const acceptRes = await api(`/api/cases/app_apex_1/forms/ai-suggestions/${key}`, {
        method: 'PATCH',
        token: token1,
        body: { decision: 'ACCEPT' },
      });
      assert.equal(acceptRes.status, 200);
      assert.equal(acceptRes.data.form.sourceAttribution[key], 'AI_SUGGESTION_ACCEPTED');
      assert.equal(acceptRes.data.form.aiSuggestions[key].status, 'ACCEPTED');
    }

    // Consultant CANNOT sign applicant's declaration -> 403
    const staffApproveForbidden = await api('/api/cases/app_apex_1/forms/approve', {
      method: 'POST',
      token: consultantToken,
      body: { attestationAccepted: true },
    });
    assert.equal(staffApproveForbidden.status, 403);

    // Applicant signs declaration and approves form
    const approveOk = await api('/api/cases/app_apex_1/forms/approve', {
      method: 'POST',
      token: token1,
      body: { attestationAccepted: true },
    });
    assert.equal(approveOk.status, 200);
    assert.equal(approveOk.data.form.applicantApproved, true);

    // Post-approval edit resets applicantApproved -> requires re-approval
    const postEdit = await api('/api/cases/app_apex_1/forms/draft', {
      method: 'PUT',
      token: token1,
      body: {
        answers: {
          hotelNameAndBookingRef: 'Hotel Maximilian Munich — BK-9022-UPD',
        },
        changeReason: 'Updated hotel confirmation ref',
      },
    });
    assert.equal(postEdit.status, 200);
    assert.equal(postEdit.data.approvalReset, true);
    assert.equal(postEdit.data.detail.form.applicantApproved, false);

    // Re-approve for submission handoff
    const reApprove = await api('/api/cases/app_apex_1/forms/approve', {
      method: 'POST',
      token: token1,
      body: { attestationAccepted: true },
    });
    assert.equal(reApprove.status, 200);
    assert.equal(reApprove.data.form.applicantApproved, true);

    // JSON & HTML exports succeed with masked passport in HTML
    const jsonExport = await api('/api/cases/app_apex_1/forms/export?format=json', { token: token1 });
    assert.equal(jsonExport.status, 200);
    assert.equal(jsonExport.data.caseReference, 'MRD-2026-1001');
    assert.ok(jsonExport.data.revisions.length >= 3);

    const htmlRes = await fetch(`${baseUrl}/api/cases/app_apex_1/forms/export?format=html`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(htmlRes.status, 200);
    const htmlText = await htmlRes.text();
    assert.ok(htmlText.includes('MRD-2026-1001'));
    assert.ok(htmlText.includes('••••2714'));
    assert.ok(!htmlText.includes('Z9482714'));
  });

  it('enforces submission adapter guardrails, rejects restricted portal automation, generates guided handoff packages, and maintains strict tenant isolation', async () => {
    const applicant1Login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const applicant2Login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant2@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const pacificLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'consultant@pacificrim.demo', password: DEMO_PASSWORD },
    });

    const token1 = applicant1Login.data.token;
    const token2 = applicant2Login.data.token;
    const pacificToken = pacificLogin.data.token;

    // 1. Capabilities show Official API NOT configured and Guided Manual Handoff available
    const capRes = await api('/api/cases/app_apex_1/submission', { token: token1 });
    assert.equal(capRes.status, 200);
    const officialCap = capRes.data.capabilities.find(
      (c: any) => c.mode === 'AUTHORIZED_OFFICIAL_API',
    );
    const guidedCap = capRes.data.capabilities.find(
      (c: any) => c.mode === 'GUIDED_MANUAL_HANDOFF',
    );
    assert.equal(officialCap.available, false);
    assert.equal(guidedCap.available, true);

    // 2. Policy guardrail blocks prohibited portal automation / CAPTCHA bypass modes with 403
    const botAttempt = await api('/api/cases/app_apex_1/submission/handoff', {
      method: 'POST',
      token: token1,
      body: { mode: 'HEADLESS_BROWSER_AUTOMATION' },
    });
    assert.equal(botAttempt.status, 403);
    assert.match(botAttempt.data.error, /strictly prohibited/i);

    const captchaAttempt = await api('/api/cases/app_apex_1/submission/handoff', {
      method: 'POST',
      token: token1,
      body: { mode: 'CAPTCHA_BYPASS' },
    });
    assert.equal(captchaAttempt.status, 403);

    // 3. Unconfigured official API refuses cleanly with 409 (never fakes official submission)
    const unconfiguredApiAttempt = await api('/api/cases/app_apex_1/submission/handoff', {
      method: 'POST',
      token: token1,
      body: { mode: 'AUTHORIZED_OFFICIAL_API' },
    });
    assert.equal(unconfiguredApiAttempt.status, 409);

    // 4. Guided Manual Handoff package succeeds for approved form
    const handoffRes = await api('/api/cases/app_apex_1/submission/handoff', {
      method: 'POST',
      token: token1,
      body: { mode: 'GUIDED_MANUAL_HANDOFF' },
    });
    assert.equal(handoffRes.status, 201);
    assert.equal(handoffRes.data.status, 'HANDOFF_PACKAGE_READY');
    assert.ok(handoffRes.data.handoffPackage.checklistSteps.length >= 4);
    assert.equal(handoffRes.data.handoffPackage.sections.length, 3);

    // 5. Confirm manual external submission updates governmentStatusSource honestly (APPLICANT_UPLOADED_NOTICE)
    const confirmManual = await api(
      `/api/cases/app_apex_1/submission/${handoffRes.data.handoffId}/confirm-manual`,
      {
        method: 'POST',
        token: token1,
        body: { externalConfirmationRef: 'VFS-DE-2027-88412' },
      },
    );
    assert.equal(confirmManual.status, 200);
    assert.equal(confirmManual.data.governmentStatusSource, 'APPLICANT_UPLOADED_NOTICE');

    // 6. Strict cross-applicant & cross-tenant isolation
    const sameTenantOtherApplicant = await api('/api/cases/app_apex_1/forms', { token: token2 });
    assert.equal(sameTenantOtherApplicant.status, 403);

    const crossTenantFormRead = await api('/api/cases/app_apex_1/forms', { token: pacificToken });
    assert.equal(crossTenantFormRead.status, 403);

    const crossTenantHandoff = await api('/api/cases/app_apex_1/submission/handoff', {
      method: 'POST',
      token: pacificToken,
      body: { mode: 'GUIDED_MANUAL_HANDOFF' },
    });
    assert.equal(crossTenantHandoff.status, 403);
  });
});
