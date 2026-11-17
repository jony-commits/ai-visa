import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApiApp } from '../server/app.ts';
import { openDatabase, type AppDatabase } from '../server/db.ts';
import { DEMO_PASSWORD, seedDatabase } from '../server/seed.ts';

let db: AppDatabase;
let server: http.Server;
let baseUrl: string;
let tempStorageDir: string;

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

function makeSamplePdfBase64(lines: string[]): string {
  const content = `%PDF-1.4\n${lines.join('\n')}\n%%EOF\n`;
  return Buffer.from(content, 'utf8').toString('base64');
}

before(async () => {
  tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-docs-test-'));
  process.env.PRIVATE_STORAGE_DIR = tempStorageDir;

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
  fs.rmSync(tempStorageDir, { recursive: true, force: true });
  delete process.env.PRIVATE_STORAGE_DIR;
});

describe('AI Visa Document Processing, Private Storage & Verification Module', () => {
  it('generates dynamic route-and-dependent checklists and rejects spoofed or unsupported files', async () => {
    const loginRes = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    assert.equal(loginRes.status, 200);
    const applicantToken = loginRes.data.token;

    // 1. Checklist includes Germany Schengen docs + dependent relationship proof for Aarav
    const checklistRes = await api('/api/cases/app_apex_1/checklist', {
      token: applicantToken,
    });
    assert.equal(checklistRes.status, 200);
    const reqCodes = checklistRes.data.requirements.map((r: any) => r.requirement_code);
    assert.ok(reqCodes.includes('PASSPORT_BIO_PAGE'));
    assert.ok(reqCodes.includes('SCHENGEN_TRAVEL_INSURANCE'));
    assert.ok(reqCodes.includes('FAMILY_RELATIONSHIP_PROOF'));

    // 2. Reject unsupported MIME type (.exe / text/plain)
    const badMimeRes = await api('/api/cases/app_apex_1/documents', {
      method: 'POST',
      token: applicantToken,
      body: {
        filename: 'script.txt',
        mimeType: 'text/plain',
        contentBase64: Buffer.from('hello world').toString('base64'),
        documentType: 'OTHER',
      },
    });
    assert.equal(badMimeRes.status, 400);

    // 3. Reject magic-byte spoofing (claiming JPEG when bytes are plain ASCII)
    const spoofedRes = await api('/api/cases/app_apex_1/documents', {
      method: 'POST',
      token: applicantToken,
      body: {
        filename: 'fake.jpg',
        mimeType: 'image/jpeg',
        contentBase64: Buffer.from('NOT_A_REAL_JPEG_IMAGE').toString('base64'),
        documentType: 'PASSPORT_PHOTO',
      },
    });
    assert.equal(spoofedRes.status, 400);
    assert.match(spoofedRes.data.error, /JPEG signature/i);
  });

  it('quarantines malware-flagged files, blocks downloads, and blocks officer verification approval', async () => {
    const applicantLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const officerLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'officer@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const applicantToken = applicantLogin.data.token;
    const officerToken = officerLogin.data.token;

    const eicarPdfB64 = makeSamplePdfBase64([
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    ]);

    const uploadRes = await api('/api/cases/app_apex_1/documents', {
      method: 'POST',
      token: applicantToken,
      body: {
        filename: 'eicar-infected.pdf',
        mimeType: 'application/pdf',
        contentBase64: eicarPdfB64,
        documentType: 'OTHER',
      },
    });
    assert.equal(uploadRes.status, 201);
    const quarantinedDocId = uploadRes.data.document.id;
    assert.equal(uploadRes.data.document.malwareScanStatus, 'QUARANTINED');

    // Download URL denied for quarantined file
    const dlRes = await api(`/api/documents/${quarantinedDocId}/download-url`, {
      token: applicantToken,
    });
    assert.equal(dlRes.status, 403);

    // Officer cannot mark quarantined file as VERIFIED
    const reviewRes = await api(`/api/documents/${quarantinedDocId}/review`, {
      method: 'PATCH',
      token: officerToken,
      body: { reviewStatus: 'VERIFIED' },
    });
    assert.equal(reviewRes.status, 400);

    // Clean up quarantined doc so subsequent tests evaluate clean docs
    const delRes = await api(`/api/documents/${quarantinedDocId}`, {
      method: 'DELETE',
      token: applicantToken,
    });
    assert.equal(delRes.status, 200);
  });

  it('supports two-step signed URL upload & download, extracts passport fields, preserves raw OCR during manual correction, and flags duplicates & mismatches', async () => {
    const applicantLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const officerLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'officer@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const applicantToken = applicantLogin.data.token;
    const officerToken = officerLogin.data.token;

    // Step 1: Request two-step signed upload URL for valid matching Passport PDF
    const initUpload = await api('/api/cases/app_apex_1/documents/upload-url', {
      method: 'POST',
      token: applicantToken,
      body: {
        filename: 'aarav-passport-bio.pdf',
        mimeType: 'application/pdf',
        byteSize: 180,
        documentType: 'PASSPORT',
        requirementCode: 'PASSPORT_BIO_PAGE',
      },
    });
    assert.equal(initUpload.status, 201);
    assert.ok(initUpload.data.uploadUrl.includes('/api/storage/signed-upload'));

    const passportBuffer = Buffer.from(
      '%PDF-1.4\nPassport No: Z9482714\nFull Name: Aarav Mehta\nDate of Birth: 1993-07-14\nNationality: IN\nExpiry Date: 2032-03-14\n%%EOF\n',
      'utf8',
    );

    const putRes = await fetch(`${baseUrl}${initUpload.data.uploadUrl}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: passportBuffer,
    });
    assert.equal(putRes.status, 200);
    const putData = (await putRes.json()) as Record<string, any>;
    assert.equal(putData.uploaded, true);
    assert.equal(putData.pipeline.scanJob.status, 'COMPLETED');
    assert.equal(putData.pipeline.extractJob.status, 'COMPLETED');
    assert.equal(putData.pipeline.verifyJob.status, 'COMPLETED');

    const passportDocId = initUpload.data.documentId;

    // Fetch case documents and verify extraction + verification guardrails
    const listRes = await api('/api/cases/app_apex_1/documents', {
      token: applicantToken,
    });
    assert.equal(listRes.status, 200);
    const passportDoc = listRes.data.documents.find((d: any) => d.id === passportDocId);
    assert.ok(passportDoc);
    assert.equal(passportDoc.malwareScanStatus, 'CLEAN');
    assert.equal(passportDoc.extraction.detectedDocumentType, 'PASSPORT');
    assert.equal(passportDoc.extraction.extracted.fields.passportNumber, 'Z9482714');
    assert.equal(passportDoc.extraction.extracted.fields.fullName, 'Aarav Mehta');
    assert.equal(passportDoc.extraction.extracted.fields.expiryDate, '2032-03-14');
    assert.match(passportDoc.extraction.aiDisclaimer, /cannot certify document authenticity/i);

    // Separate verification layers must keep external_identity_status as NOT_CONNECTED
    assert.equal(listRes.data.verification.external_identity_status, 'NOT_CONNECTED');

    // Signed download URL works cleanly & rejects tampered signatures
    const dlUrlRes = await api(`/api/documents/${passportDocId}/download-url`, {
      token: applicantToken,
    });
    assert.equal(dlUrlRes.status, 200);
    const binaryRes = await fetch(`${baseUrl}${dlUrlRes.data.url}`);
    assert.equal(binaryRes.status, 200);
    const downloadedBuf = Buffer.from(await binaryRes.arrayBuffer());
    assert.equal(downloadedBuf.toString('utf8'), passportBuffer.toString('utf8'));

    const tamperedRes = await fetch(`${baseUrl}${dlUrlRes.data.url}tampered`);
    assert.equal(tamperedRes.status, 403);

    // Manual correction preserves rawOcrText & extracted.fields separately
    const corrRes = await api(`/api/documents/${passportDocId}/extraction`, {
      method: 'PATCH',
      token: officerToken,
      body: {
        fields: {
          ...passportDoc.extraction.extracted.fields,
          issuingCountry: 'IN',
        },
        confirm: true,
      },
    });
    assert.equal(corrRes.status, 200);
    assert.equal(corrRes.data.isConfirmed, true);

    const afterCorrList = await api('/api/cases/app_apex_1/documents', { token: officerToken });
    const updatedPassport = afterCorrList.data.documents.find((d: any) => d.id === passportDocId);
    assert.equal(updatedPassport.extraction.isConfirmed, true);
    assert.equal(updatedPassport.extraction.corrected.fields.issuingCountry, 'IN');
    assert.ok(updatedPassport.extraction.rawOcrText.includes('Passport No: Z9482714'));

    // Duplicate upload detection (re-upload identical buffer)
    const dupRes = await api('/api/cases/app_apex_1/documents', {
      method: 'POST',
      token: applicantToken,
      body: {
        filename: 'aarav-passport-duplicate.pdf',
        mimeType: 'application/pdf',
        contentBase64: passportBuffer.toString('base64'),
        documentType: 'PASSPORT',
      },
    });
    assert.equal(dupRes.status, 201);
    const dupIssue = dupRes.data.issues.find((i: any) => i.issue_type === 'DUPLICATE_DOCUMENT');
    assert.ok(dupIssue, 'Expected duplicate SHA-256 upload to create DUPLICATE_DOCUMENT issue');

    // Cross-document name & passport mismatch + expired bank statement / document check
    const mismatchedBankRes = await api('/api/cases/app_apex_1/documents', {
      method: 'POST',
      token: applicantToken,
      body: {
        filename: 'mismatched-statement.pdf',
        mimeType: 'application/pdf',
        contentBase64: makeSamplePdfBase64([
          'Bank Statement',
          'Account Holder: Rohan Kapoor',
          'Passport No: X0000999',
          'Date of Birth: 1990-01-01',
          'Closing Balance: 8450.00',
          'Currency: EUR',
          'Expiry Date: 2020-01-01',
        ]),
        documentType: 'BANK_STATEMENT',
        requirementCode: 'BANK_STATEMENTS',
      },
    });
    assert.equal(mismatchedBankRes.status, 201);
    const issueTypes = mismatchedBankRes.data.issues.map((i: any) => i.issue_type);
    assert.ok(issueTypes.includes('CROSS_DOCUMENT_NAME_MISMATCH'));
    assert.ok(issueTypes.includes('CROSS_DOCUMENT_PASSPORT_MISMATCH'));
    assert.ok(issueTypes.includes('CROSS_DOCUMENT_DOB_MISMATCH'));
    assert.ok(issueTypes.includes('EXPIRED_DOCUMENT'));
    assert.ok(issueTypes.includes('MISSING_MANDATORY_DOCUMENT'));
    assert.equal(mismatchedBankRes.data.verification.consistency_status, 'FAILED');
  });

  it('enforces RBAC for officer approvals & verification queue and blocks cross-applicant and cross-tenant document access', async () => {
    const applicant1Login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const applicant2Login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'applicant2@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const officerLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'officer@apexmobility.demo', password: DEMO_PASSWORD },
    });
    const pacificLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'consultant@pacificrim.demo', password: DEMO_PASSWORD },
    });

    const docsRes = await api('/api/cases/app_apex_1/documents', {
      token: applicant1Login.data.token,
    });
    assert.equal(docsRes.status, 200);
    const passportDoc = docsRes.data.documents.find((d: any) => d.documentType === 'PASSPORT');
    assert.ok(passportDoc);

    // Applicant cannot access verification queue or approve their own document
    const queueForbidden = await api('/api/verification-queue', {
      token: applicant1Login.data.token,
    });
    assert.equal(queueForbidden.status, 403);

    const approveForbidden = await api(`/api/documents/${passportDoc.id}/review`, {
      method: 'PATCH',
      token: applicant1Login.data.token,
      body: { reviewStatus: 'VERIFIED' },
    });
    assert.equal(approveForbidden.status, 403);

    // Another applicant in the SAME organization cannot read or download Aarav's document
    const sameTenantForbidden = await api('/api/cases/app_apex_1/documents', {
      token: applicant2Login.data.token,
    });
    assert.equal(sameTenantForbidden.status, 403);

    const dlForbiddenSameTenant = await api(`/api/documents/${passportDoc.id}/download-url`, {
      token: applicant2Login.data.token,
    });
    assert.equal(dlForbiddenSameTenant.status, 403);

    // Staff in DIFFERENT organization (Pacific Rim) cannot access Apex documents or approve them
    const crossTenantList = await api('/api/cases/app_apex_1/documents', {
      token: pacificLogin.data.token,
    });
    assert.equal(crossTenantList.status, 403);

    const crossTenantReview = await api(`/api/documents/${passportDoc.id}/review`, {
      method: 'PATCH',
      token: pacificLogin.data.token,
      body: { reviewStatus: 'VERIFIED' },
    });
    assert.equal(crossTenantReview.status, 403);

    // Verification Officer in Apex Global CAN list verification queue and approve passport
    const queueOk = await api('/api/verification-queue', {
      token: officerLogin.data.token,
    });
    assert.equal(queueOk.status, 200);
    assert.ok(queueOk.data.pendingDocuments.length > 0);
    assert.ok(queueOk.data.openIssues.length > 0);

    const officerApprove = await api(`/api/documents/${passportDoc.id}/review`, {
      method: 'PATCH',
      token: officerLogin.data.token,
      body: { reviewStatus: 'VERIFIED', reviewNotes: 'Bio page clear and matches profile.' },
    });
    assert.equal(officerApprove.status, 200);
    assert.equal(officerApprove.data.reviewStatus, 'VERIFIED');

    // Officer can resolve an open verification issue from the latest verification run
    const currentOpenIssue = officerApprove.data.issues.find((i: any) => i.status === 'OPEN');
    assert.ok(currentOpenIssue);
    const resolveIssue = await api(`/api/verification-issues/${currentOpenIssue.id}`, {
      method: 'PATCH',
      token: officerLogin.data.token,
      body: { status: 'RESOLVED', resolutionNote: 'Verified manually' },
    });
    assert.equal(resolveIssue.status, 200);
  });
});
