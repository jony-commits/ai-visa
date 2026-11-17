import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApiApp } from '../server/app.ts';
import { openDatabase, type AppDatabase } from '../server/db.ts';
import { scheduleNotificationFromTemplate } from '../server/services/notifications.ts';
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

describe('Phase 5: Configurable Workflows, Source-Verified Tracking, Appointments & Notifications', () => {
  it('enforces configurable per-org workflow stages, core stage safety, and transitions', async () => {
    const adminToken = await login('admin@apexmobility.demo');
    const consultantToken = await login('consultant@apexmobility.demo');
    const applicantToken = await login('applicant@apexmobility.demo');
    const pacificToken = await login('consultant@pacificrim.demo');

    // Applicant cannot modify workflow stages
    const applicantEdit = await api('/api/workflows/stages/ON_HOLD', {
      method: 'PATCH',
      token: applicantToken,
      body: { enabled: false },
    });
    assert.equal(applicantEdit.status, 403);

    // Admin cannot disable core stage
    const disableCore = await api('/api/workflows/stages/DOCUMENT_COLLECTION', {
      method: 'PATCH',
      token: adminToken,
      body: { enabled: false },
    });
    assert.equal(disableCore.status, 400);

    // Admin customizes DOCUMENT_VERIFICATION SLA & label and disables ON_HOLD
    const customVerify = await api('/api/workflows/stages/DOCUMENT_VERIFICATION', {
      method: 'PATCH',
      token: adminToken,
      body: { displayLabel: 'Compliance Officer Review', slaHours: 36, notifyOnEnter: true },
    });
    assert.equal(customVerify.status, 200);
    const verifyStage = customVerify.data.stages.find(
      (s: any) => s.stageCode === 'DOCUMENT_VERIFICATION',
    );
    assert.equal(verifyStage.displayLabel, 'Compliance Officer Review');
    assert.equal(verifyStage.slaHours, 36);

    const disableOnHold = await api('/api/workflows/stages/ON_HOLD', {
      method: 'PATCH',
      token: adminToken,
      body: { enabled: false },
    });
    assert.equal(disableOnHold.status, 200);

    // Pacific Rim tenant stages must remain unmodified (strict tenant isolation)
    const pacificStages = await api('/api/workflows/stages', { token: pacificToken });
    assert.equal(pacificStages.status, 200);
    const pacificOnHold = pacificStages.data.stages.find((s: any) => s.stageCode === 'ON_HOLD');
    assert.equal(pacificOnHold.enabled, true);

    // Transitioning app_apex_1 to disabled ON_HOLD is rejected
    const blockedTransition = await api('/api/cases/app_apex_1/transition', {
      method: 'PATCH',
      token: consultantToken,
      body: { toStatus: 'ON_HOLD', reason: 'Should fail when disabled' },
    });
    assert.equal(blockedTransition.status, 400);

    // Transitioning app_apex_1 to DOCUMENT_VERIFICATION succeeds, sets SLA stageDueAt, and queues notifications
    const validTransition = await api('/api/cases/app_apex_1/transition', {
      method: 'PATCH',
      token: consultantToken,
      body: { toStatus: 'DOCUMENT_VERIFICATION', reason: 'Docs uploaded' },
    });
    assert.equal(validTransition.status, 200);
    assert.equal(validTransition.data.toStatus, 'DOCUMENT_VERIFICATION');
    assert.ok(validTransition.data.stageDueAt);
    assert.ok(validTransition.data.notifications.length >= 1);
  });

  it('tracks deadlines, appointments, and unified chronological timeline with strict RBAC', async () => {
    const consultantToken = await login('consultant@apexmobility.demo');
    const applicantToken = await login('applicant@apexmobility.demo');

    // Applicant cannot edit case deadlines or schedule appointments
    const appDeadlineErr = await api('/api/cases/app_apex_1/deadlines', {
      method: 'PATCH',
      token: applicantToken,
      body: { targetSubmissionDeadline: '2027-02-01T12:00:00.000Z' },
    });
    assert.equal(appDeadlineErr.status, 403);

    const appApptErr = await api('/api/cases/app_apex_1/appointments', {
      method: 'POST',
      token: applicantToken,
      body: {
        appointmentType: 'CONSULATE_INTERVIEW',
        centerName: 'German Consulate San Francisco',
        scheduledAt: '2027-03-01T09:30:00.000Z',
      },
    });
    assert.equal(appApptErr.status, 403);

    // Consultant sets deadline + reminder & books consulate interview
    const deadlineRes = await api('/api/cases/app_apex_1/deadlines', {
      method: 'PATCH',
      token: consultantToken,
      body: {
        targetSubmissionDeadline: '2027-02-15T17:00:00.000Z',
        scheduleReminder: true,
      },
    });
    assert.equal(deadlineRes.status, 200);
    assert.ok(deadlineRes.data.scheduledNotifications.length >= 1);

    const apptRes = await api('/api/cases/app_apex_1/appointments', {
      method: 'POST',
      token: consultantToken,
      body: {
        appointmentType: 'CONSULATE_INTERVIEW',
        centerName: 'German Consulate General San Francisco',
        scheduledAt: '2027-03-05T10:15:00.000Z',
        timezone: 'America/Los_Angeles',
        bookingReference: 'CG-SF-9091',
      },
    });
    assert.equal(apptRes.status, 201);
    const apptId = apptRes.data.appointment.id;
    assert.ok(apptRes.data.notifications.length >= 1);

    // Reschedule appointment -> queues updated notification
    const rescheduleRes = await api(`/api/cases/app_apex_1/appointments/${apptId}`, {
      method: 'PATCH',
      token: consultantToken,
      body: {
        status: 'RESCHEDULED',
        scheduledAt: '2027-03-06T11:00:00.000Z',
      },
    });
    assert.equal(rescheduleRes.status, 200);
    assert.equal(rescheduleRes.data.appointment.status, 'RESCHEDULED');
    assert.ok(rescheduleRes.data.notifications.length >= 1);

    // Unified timeline combines workflow transitions, appointments, and notifications
    const tlRes = await api('/api/cases/app_apex_1/timeline', { token: applicantToken });
    assert.equal(tlRes.status, 200);
    const categories = new Set(tlRes.data.timeline.map((e: any) => e.category));
    assert.ok(categories.has('INTERNAL_WORKFLOW'));
    assert.ok(categories.has('APPOINTMENT'));
    assert.ok(categories.has('NOTIFICATION'));
  });

  it('never fabricates official status changes, blocks manual OFFICIAL_API spoofing, and syncs when authorized endpoint exists', async () => {
    const consultantToken = await login('consultant@apexmobility.demo');

    // Before external update, status sync returns 409 UNAVAILABLE and does not mutate status
    const unconfiguredSync = await api('/api/cases/app_apex_1/status-sync', {
      method: 'POST',
      token: consultantToken,
    });
    assert.equal(unconfiguredSync.status, 409);
    assert.equal(unconfiguredSync.data.synced, false);

    const overviewBefore = await api('/api/cases/app_apex_1/status-tracking', {
      token: consultantToken,
    });
    assert.equal(overviewBefore.status, 200);
    assert.equal(overviewBefore.data.governmentStatus, 'NOT_SUBMITTED');
    assert.equal(overviewBefore.data.governmentStatusVerifiedAt, null);

    // Spoofing OFFICIAL_API via manual status-events endpoint is rejected
    const spoofAttempt = await api('/api/cases/app_apex_1/status-events', {
      method: 'POST',
      token: consultantToken,
      body: {
        statusText: 'Approved',
        sourceType: 'OFFICIAL_API',
      },
    });
    assert.equal(spoofAttempt.status, 400);

    // Manual source-attributed update stamps government_status_verified_at & separates from internal_status
    const manualRes = await api('/api/cases/app_apex_1/status-events', {
      method: 'POST',
      token: consultantToken,
      body: {
        statusText: 'Biometrics Received at VFS Center',
        sourceType: 'APPLICANT_UPLOADED_NOTICE',
        trackingReference: 'VFS-RECEIPT-772',
        rawEvidenceNote: 'Verified stamped VFS intake slip PDF',
      },
    });
    assert.equal(manualRes.status, 201);
    assert.ok(manualRes.data.event.verifiedAt);

    const afterManual = await api('/api/cases/app_apex_1/status-tracking', {
      token: consultantToken,
    });
    assert.equal(afterManual.data.governmentStatus, 'Biometrics Received at VFS Center');
    assert.equal(afterManual.data.governmentStatusSource, 'APPLICANT_UPLOADED_NOTICE');
    assert.equal(afterManual.data.internalStatus, 'DOCUMENT_VERIFICATION');
    assert.ok(afterManual.data.governmentStatusVerifiedAt);

    // Authorized Official API mock endpoint test
    const mockOfficialServer = http.createServer((req, res) => {
      assert.equal(req.headers.authorization, 'Bearer test-consular-secret');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          statusText: 'Visa Decision Issued — Passport Dispatched',
          trackingReference: 'CONSULAR-DE-99441',
          verifiedAt: '2027-03-10T14:20:00.000Z',
          evidenceNote: 'Received directly from authorized German Federal Foreign Office status feed',
        }),
      );
    });

    await new Promise<void>((resolve) => mockOfficialServer.listen(0, '127.0.0.1', resolve));
    const mockAddr = mockOfficialServer.address() as { port: number };
    const prevUrl = process.env.OFFICIAL_STATUS_API_URL;
    const prevKey = process.env.OFFICIAL_STATUS_API_KEY;
    process.env.OFFICIAL_STATUS_API_URL = `http://127.0.0.1:${mockAddr.port}/status`;
    process.env.OFFICIAL_STATUS_API_KEY = 'test-consular-secret';

    try {
      const syncRes = await api('/api/cases/app_apex_1/status-sync', {
        method: 'POST',
        token: consultantToken,
      });
      assert.equal(syncRes.status, 200);
      assert.equal(syncRes.data.synced, true);
      assert.equal(syncRes.data.sourceType, 'OFFICIAL_API');
      assert.equal(syncRes.data.trackingReference, 'CONSULAR-DE-99441');
      assert.equal(syncRes.data.verifiedAt, '2027-03-10T14:20:00.000Z');
    } finally {
      if (prevUrl === undefined) delete process.env.OFFICIAL_STATUS_API_URL;
      else process.env.OFFICIAL_STATUS_API_URL = prevUrl;
      if (prevKey === undefined) delete process.env.OFFICIAL_STATUS_API_KEY;
      else process.env.OFFICIAL_STATUS_API_KEY = prevKey;
      await new Promise<void>((resolve) => mockOfficialServer.close(() => resolve()));
    }
  });

  it('customizes Email/SMS templates, respects COMMUNICATIONS consent, executes retry backoff -> FAILED_PERMANENT, and isolates tenants', async () => {
    const adminToken = await login('admin@apexmobility.demo');
    const consultantToken = await login('consultant@apexmobility.demo');
    const applicantToken = await login('applicant@apexmobility.demo');
    const pacificToken = await login('consultant@pacificrim.demo');

    // Admin customizes template; applicant blocked
    const applicantTpl = await api('/api/notifications/templates/CASE_STAGE_CHANGED/EMAIL', {
      method: 'PATCH',
      token: applicantToken,
      body: { bodyTemplate: 'Hack attempt' },
    });
    assert.equal(applicantTpl.status, 403);

    const customTpl = await api('/api/notifications/templates/CASE_STAGE_CHANGED/EMAIL', {
      method: 'PATCH',
      token: adminToken,
      body: {
        subjectTemplate: '[Apex Custom] {{referenceNumber}} -> {{stageLabel}}',
        bodyTemplate: 'Custom Apex update for {{recipientName}}: stage is now {{stageLabel}}.',
        isActive: true,
      },
    });
    assert.equal(customTpl.status, 200);
    assert.equal(customTpl.data.template.isCustomOverride, true);

    // Revoke applicant COMMUNICATIONS consent -> notifications become SKIPPED_NO_CONSENT
    const revokeRes = await api('/api/applicant/consents', {
      method: 'PUT',
      token: applicantToken,
      body: {
        personalDataProcessing: true,
        externalAiProcessing: true,
        communications: false,
      },
    });
    assert.equal(revokeRes.status, 200);

    const skippedDeadline = await api('/api/cases/app_apex_1/deadlines', {
      method: 'PATCH',
      token: consultantToken,
      body: {
        targetSubmissionDeadline: '2027-02-20T12:00:00.000Z',
        scheduleReminder: true,
      },
    });
    assert.equal(skippedDeadline.status, 200);
    const applicantJobsWhenRevoked = skippedDeadline.data.scheduledNotifications.filter(
      (j: any) => j.recipientUserId === 'usr_applicant_apex',
    );
    assert.ok(applicantJobsWhenRevoked.length >= 1);
    assert.ok(
      applicantJobsWhenRevoked.every((j: any) => j.status === 'SKIPPED_NO_CONSENT'),
    );

    // Schedule deterministic retry & permanent failure job using 'fail://' gateway test prefix
    const failingJob = scheduleNotificationFromTemplate(db, {
      organizationId: 'org_apex',
      applicationId: 'app_apex_1',
      recipientUserId: 'usr_consultant_apex',
      recipientRole: 'STAFF',
      recipientContact: 'fail://unreachable-smtp-host',
      channel: 'EMAIL',
      templateKey: 'DEADLINE_REMINDER',
      variables: {
        recipientName: 'Elena Rostova',
        referenceNumber: 'MRD-2026-1001',
        targetDeadline: '2027-02-20',
        stageDueAt: '2027-02-10',
      },
      maxAttempts: 3,
    });
    assert.ok(failingJob);
    assert.equal(failingJob.status, 'SCHEDULED');

    // Attempt 1 -> RETRY_WAIT
    const run1 = await api('/api/notifications/run-worker', {
      method: 'POST',
      token: consultantToken,
      body: { jobId: failingJob.id, forceDue: true },
    });
    assert.equal(run1.status, 200);
    assert.equal(run1.data.retried, 1);
    assert.equal(run1.data.jobs[0].status, 'RETRY_WAIT');
    assert.equal(run1.data.jobs[0].attempts, 1);

    // Attempt 2 -> RETRY_WAIT
    const run2 = await api(`/api/notifications/${failingJob.id}/retry`, {
      method: 'POST',
      token: consultantToken,
      body: {},
    });
    assert.equal(run2.status, 200);
    assert.equal(run2.data.result.jobs[0].status, 'RETRY_WAIT');
    assert.equal(run2.data.result.jobs[0].attempts, 2);

    // Attempt 3 -> FAILED_PERMANENT
    const run3 = await api(`/api/notifications/${failingJob.id}/retry`, {
      method: 'POST',
      token: consultantToken,
      body: {},
    });
    assert.equal(run3.status, 200);
    assert.equal(run3.data.result.failedPermanent, 1);
    assert.equal(run3.data.result.jobs[0].status, 'FAILED_PERMANENT');
    assert.equal(run3.data.result.jobs[0].attempts, 3);

    // Exhausted job cannot retry without resetAttempts
    const blockedRetry = await api(`/api/notifications/${failingJob.id}/retry`, {
      method: 'POST',
      token: consultantToken,
      body: {},
    });
    assert.equal(blockedRetry.status, 409);

    // Cross-tenant isolation check
    const crossTenantTrack = await api('/api/cases/app_apex_1/status-tracking', {
      token: pacificToken,
    });
    assert.equal(crossTenantTrack.status, 403);

    const crossTenantRetry = await api(`/api/notifications/${failingJob.id}/retry`, {
      method: 'POST',
      token: pacificToken,
      body: { resetAttempts: true },
    });
    assert.equal(crossTenantRetry.status, 403);

    // Deliver all remaining valid Apex jobs and verify DELIVERED state
    const runAll = await api('/api/notifications/run-worker', {
      method: 'POST',
      token: consultantToken,
      body: { forceDue: true },
    });
    assert.equal(runAll.status, 200);
    assert.ok(runAll.data.delivered >= 1);
  });
});
