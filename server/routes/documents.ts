import express, { Request, Response, Router } from 'express';
import { AppDatabase, newId, writeAuditLog } from '../db.ts';
import { requireAuth, requireRoles } from '../middleware.ts';
import {
  enqueueAndExecuteJob,
  QUEUE_DOCUMENT_PROCESSING,
  runDocumentUploadPipeline,
} from '../services/queue.ts';
import {
  buildStorageKey,
  createS3PresignedUrl,
  getPrivateObject,
  getStorageConfig,
  isS3Configured,
  putPrivateObject,
  signStorageToken,
  validateFileMagicBytes,
  validateUploadMetadata,
  verifyStorageToken,
} from '../services/storage.ts';
import { runCaseVerification, syncChecklistForCase } from '../services/verification.ts';

function authorizeCaseAccess(
  db: AppDatabase,
  req: Request,
  res: Response,
  caseId: string,
): Record<string, unknown> | null {
  const appRow = db
    .prepare('SELECT * FROM visa_applications WHERE id = ?')
    .get(caseId) as Record<string, unknown> | undefined;

  if (!appRow) {
    res.status(404).json({ error: 'Visa application not found' });
    return null;
  }

  if (!req.auth!.isPlatformAdmin && String(appRow.organization_id) !== req.auth!.organizationId) {
    res.status(403).json({ error: 'Forbidden: cross-tenant document access denied' });
    return null;
  }

  if (
    req.auth!.role === 'APPLICANT' &&
    !req.auth!.isPlatformAdmin &&
    String(appRow.applicant_user_id) !== req.auth!.userId
  ) {
    res.status(403).json({ error: 'Forbidden: applicants can only access documents on their own cases' });
    return null;
  }

  return appRow;
}

function authorizeDocumentAccess(
  db: AppDatabase,
  req: Request,
  res: Response,
  docId: string,
): Record<string, unknown> | null {
  const docRow = db
    .prepare(
      `
      SELECT d.*, a.applicant_user_id
      FROM application_documents d
      JOIN visa_applications a ON a.id = d.application_id
      WHERE d.id = ?
    `,
    )
    .get(docId) as Record<string, unknown> | undefined;

  if (!docRow) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }

  if (!req.auth!.isPlatformAdmin && String(docRow.organization_id) !== req.auth!.organizationId) {
    res.status(403).json({ error: 'Forbidden: cross-tenant document access denied' });
    return null;
  }

  if (
    req.auth!.role === 'APPLICANT' &&
    !req.auth!.isPlatformAdmin &&
    String(docRow.applicant_user_id) !== req.auth!.userId
  ) {
    res.status(403).json({ error: 'Forbidden: applicants can only access their own documents' });
    return null;
  }

  return docRow;
}

function buildSignedDownloadPath(documentId: string, organizationId: string): {
  url: string;
  expiresAt: string;
} {
  const expiresAtMs = Date.now() + 15 * 60 * 1000;
  const sig = signStorageToken({
    documentId,
    organizationId,
    action: 'DOWNLOAD',
    expiresAtMs,
  });
  return {
    url: `/api/storage/signed-download?docId=${encodeURIComponent(documentId)}&orgId=${encodeURIComponent(organizationId)}&exp=${expiresAtMs}&sig=${sig}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

function formatDocumentRow(row: Record<string, unknown>) {
  const extraction = row.extraction_id
    ? {
        id: String(row.extraction_id),
        ocrProvider: String(row.ocr_provider),
        aiProvider: String(row.ai_provider),
        modelName: String(row.model_name),
        promptVersion: String(row.prompt_version),
        rawOcrText: String(row.raw_ocr_text || ''),
        detectedDocumentType: String(row.detected_document_type),
        extracted: row.extracted_json ? JSON.parse(String(row.extracted_json)) : null,
        corrected: row.corrected_json ? JSON.parse(String(row.corrected_json)) : null,
        confidenceScore: Number(row.confidence_score ?? 0),
        isConfirmed: Boolean(row.is_confirmed),
        confirmedByUserId: row.confirmed_by_user_id ? String(row.confirmed_by_user_id) : null,
        confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
        aiDisclaimer: String(row.ai_disclaimer || ''),
        updatedAt: String(row.extraction_updated_at || row.updated_at),
      }
    : null;

  const download = buildSignedDownloadPath(String(row.id), String(row.organization_id));

  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    organizationId: String(row.organization_id),
    requirementCode: row.requirement_code ? String(row.requirement_code) : null,
    documentType: String(row.document_type),
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    byteSize: Number(row.byte_size),
    sha256Checksum: String(row.sha256_checksum),
    version: Number(row.version),
    storageProvider: String(row.storage_provider),
    storageBucket: String(row.storage_bucket),
    expiryDate: row.expiry_date ? String(row.expiry_date) : null,
    malwareScanStatus: String(row.malware_scan_status),
    reviewStatus: String(row.review_status),
    reviewedByUserId: row.reviewed_by_user_id ? String(row.reviewed_by_user_id) : null,
    reviewedByName: row.reviewed_by_name ? String(row.reviewed_by_name) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    reviewNotes: row.review_notes ? String(row.review_notes) : null,
    uploadedByUserId: String(row.uploaded_by_user_id),
    uploadedByName: row.uploaded_by_name ? String(row.uploaded_by_name) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    signedDownloadUrl: download.url,
    signedDownloadExpiresAt: download.expiresAt,
    extraction,
  };
}

function getNextDocumentVersion(
  db: AppDatabase,
  applicationId: string,
  documentType: string,
  requirementCode: string | null,
): number {
  const row = requirementCode
    ? (db
        .prepare(
          'SELECT MAX(version) AS max_ver FROM application_documents WHERE application_id = ? AND requirement_code = ?',
        )
        .get(applicationId, requirementCode) as { max_ver: number | null } | undefined)
    : (db
        .prepare(
          'SELECT MAX(version) AS max_ver FROM application_documents WHERE application_id = ? AND document_type = ?',
        )
        .get(applicationId, documentType) as { max_ver: number | null } | undefined);
  return Number(row?.max_ver || 0) + 1;
}

export function createDocumentsRouter(db: AppDatabase): Router {
  const router = Router();

  // 1. Dynamic Document Checklist
  router.get('/cases/:caseId/checklist', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const requirements = syncChecklistForCase(
      db,
      String(appRow.id),
      String(appRow.organization_id),
    ) as Array<Record<string, unknown>>;

    const mandatory = requirements.filter((r) => Boolean(r.is_mandatory));
    const satisfiedMandatory = mandatory.filter((r) =>
      ['UPLOADED', 'VERIFIED'].includes(String(r.status)),
    );

    res.json({
      requirements,
      summary: {
        totalRequirements: requirements.length,
        mandatoryCount: mandatory.length,
        satisfiedMandatoryCount: satisfiedMandatory.length,
        missingMandatoryCount: mandatory.filter((r) => r.status === 'MISSING').length,
      },
    });
  });

  // 2. Request two-step presigned/signed upload URL
  router.post('/cases/:caseId/documents/upload-url', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const { filename, mimeType, byteSize, documentType, requirementCode, expiryDate } =
      (req.body || {}) as {
        filename?: string;
        mimeType?: string;
        byteSize?: number;
        documentType?: string;
        requirementCode?: string;
        expiryDate?: string;
      };

    const metaCheck = validateUploadMetadata(
      filename || '',
      mimeType || '',
      Number(byteSize || 0),
    );
    if (metaCheck.valid === false) {
      res.status(400).json({ error: metaCheck.error });
      return;
    }

    const docType = (documentType || 'OTHER').trim().toUpperCase();
    const reqCode = requirementCode?.trim() || null;
    const version = getNextDocumentVersion(db, String(appRow.id), docType, reqCode);
    const docId = newId('doc');
    const storageCfg = getStorageConfig();
    const storageKey = buildStorageKey(
      String(appRow.organization_id),
      String(appRow.id),
      docId,
      version,
      filename!,
    );
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO application_documents (
        id, application_id, organization_id, requirement_code, document_type,
        original_filename, mime_type, byte_size, sha256_checksum, version,
        storage_provider, storage_bucket, storage_key, expiry_date,
        malware_scan_status, review_status, uploaded_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_UPLOAD', ?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, ?, ?)
    `).run(
      docId,
      String(appRow.id),
      String(appRow.organization_id),
      reqCode,
      docType,
      filename!.trim(),
      mimeType!.trim(),
      Number(byteSize),
      version,
      storageCfg.provider,
      storageCfg.bucket,
      storageKey,
      expiryDate?.trim() || null,
      req.auth!.userId,
      now,
      now,
    );

    const expiresAtMs = Date.now() + 10 * 60 * 1000;
    const uploadUrl = isS3Configured()
      ? createS3PresignedUrl({
          method: 'PUT',
          storageKey,
          expiresInSeconds: 600,
        })
      : `/api/storage/signed-upload?docId=${encodeURIComponent(docId)}&orgId=${encodeURIComponent(String(appRow.organization_id))}&exp=${expiresAtMs}&sig=${signStorageToken({
          documentId: docId,
          organizationId: String(appRow.organization_id),
          action: 'UPLOAD',
          expiresAtMs,
        })}`;

    res.status(201).json({
      documentId: docId,
      version,
      storageProvider: storageCfg.provider,
      uploadUrl,
      method: 'PUT',
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  });

  // 3. Execute signed raw binary PUT upload to private local object storage
  router.put(
    '/storage/signed-upload',
    express.raw({ type: '*/*', limit: '11mb' }),
    async (req, res) => {
      const docId = String(req.query.docId || '');
      const orgId = String(req.query.orgId || '');
      const exp = Number(req.query.exp || 0);
      const sig = String(req.query.sig || '');

      if (
        !verifyStorageToken({
          documentId: docId,
          organizationId: orgId,
          action: 'UPLOAD',
          expiresAtMs: exp,
          signature: sig,
        })
      ) {
        res.status(403).json({ error: 'Invalid or expired signed upload URL' });
        return;
      }

      const docRow = db
        .prepare('SELECT * FROM application_documents WHERE id = ? AND organization_id = ?')
        .get(docId, orgId) as Record<string, unknown> | undefined;

      if (!docRow) {
        res.status(404).json({ error: 'Pending document record not found' });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      const metaCheck = validateUploadMetadata(
        String(docRow.original_filename),
        String(docRow.mime_type),
        buffer.length,
      );
      if (metaCheck.valid === false) {
        res.status(400).json({ error: metaCheck.error });
        return;
      }

      const magicCheck = validateFileMagicBytes(String(docRow.mime_type), buffer);
      if (magicCheck.valid === false) {
        res.status(400).json({ error: magicCheck.error });
        return;
      }

      const sha256Checksum = putPrivateObject(String(docRow.storage_key), buffer);
      const now = new Date().toISOString();

      db.prepare(
        'UPDATE application_documents SET byte_size = ?, sha256_checksum = ?, updated_at = ? WHERE id = ?',
      ).run(buffer.length, sha256Checksum, now, docId);

      const pipeline = await runDocumentUploadPipeline(db, {
        organizationId: orgId,
        applicationId: String(docRow.application_id),
        documentId: docId,
        actorUserId: String(docRow.uploaded_by_user_id),
      });

      writeAuditLog(db, {
        organizationId: orgId,
        actorUserId: String(docRow.uploaded_by_user_id),
        action: 'DOCUMENT_UPLOADED',
        resourceType: 'ApplicationDocument',
        resourceId: docId,
        metadata: {
          applicationId: docRow.application_id,
          filename: docRow.original_filename,
          mimeType: docRow.mime_type,
          byteSize: buffer.length,
          via: 'SIGNED_URL',
        },
        ipAddress: req.ip,
      });

      res.json({
        uploaded: true,
        documentId: docId,
        sha256Checksum,
        pipeline,
      });
    },
  );

  // 4. Direct JSON/Base64 Upload Convenience Endpoint (validates + stores + runs scan/OCR/verify pipeline)
  router.post('/cases/:caseId/documents', requireAuth, async (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const { filename, mimeType, contentBase64, documentType, requirementCode, expiryDate } =
      (req.body || {}) as {
        filename?: string;
        mimeType?: string;
        contentBase64?: string;
        documentType?: string;
        requirementCode?: string;
        expiryDate?: string;
      };

    if (!contentBase64 || typeof contentBase64 !== 'string') {
      res.status(400).json({ error: 'File content (contentBase64) is required' });
      return;
    }

    const cleanedBase64 = contentBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanedBase64, 'base64');

    const metaCheck = validateUploadMetadata(filename || '', mimeType || '', buffer.length);
    if (metaCheck.valid === false) {
      res.status(400).json({ error: metaCheck.error });
      return;
    }

    const magicCheck = validateFileMagicBytes(mimeType!, buffer);
    if (magicCheck.valid === false) {
      res.status(400).json({ error: magicCheck.error });
      return;
    }

    const docType = (documentType || 'OTHER').trim().toUpperCase();
    const reqCode = requirementCode?.trim() || null;
    const docId = newId('doc');
    const version = getNextDocumentVersion(db, String(appRow.id), docType, reqCode);
    const storageCfg = getStorageConfig();
    const storageKey = buildStorageKey(
      String(appRow.organization_id),
      String(appRow.id),
      docId,
      version,
      filename!,
    );
    const sha256Checksum = putPrivateObject(storageKey, buffer);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO application_documents (
        id, application_id, organization_id, requirement_code, document_type,
        original_filename, mime_type, byte_size, sha256_checksum, version,
        storage_provider, storage_bucket, storage_key, expiry_date,
        malware_scan_status, review_status, uploaded_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, ?, ?)
    `).run(
      docId,
      String(appRow.id),
      String(appRow.organization_id),
      reqCode,
      docType,
      filename!.trim(),
      mimeType!.trim(),
      buffer.length,
      sha256Checksum,
      version,
      storageCfg.provider,
      storageCfg.bucket,
      storageKey,
      expiryDate?.trim() || null,
      req.auth!.userId,
      now,
      now,
    );

    const pipeline = await runDocumentUploadPipeline(db, {
      organizationId: String(appRow.organization_id),
      applicationId: String(appRow.id),
      documentId: docId,
      actorUserId: req.auth!.userId,
    });

    writeAuditLog(db, {
      organizationId: String(appRow.organization_id),
      actorUserId: req.auth!.userId,
      action: 'DOCUMENT_UPLOADED',
      resourceType: 'ApplicationDocument',
      resourceId: docId,
      metadata: {
        applicationId: appRow.id,
        filename: filename!.trim(),
        mimeType: mimeType!.trim(),
        byteSize: buffer.length,
        documentType: docType,
        version,
      },
      ipAddress: req.ip,
    });

    const docRow = db
      .prepare(
        `
        SELECT d.*,
               u_up.full_name AS uploaded_by_name,
               u_rev.full_name AS reviewed_by_name,
               e.id AS extraction_id, e.ocr_provider, e.ai_provider, e.model_name, e.prompt_version,
               e.raw_ocr_text, e.detected_document_type, e.extracted_json, e.corrected_json,
               e.confidence_score, e.is_confirmed, e.confirmed_by_user_id, e.confirmed_at,
               e.ai_disclaimer, e.updated_at AS extraction_updated_at
        FROM application_documents d
        LEFT JOIN users u_up ON u_up.id = d.uploaded_by_user_id
        LEFT JOIN users u_rev ON u_rev.id = d.reviewed_by_user_id
        LEFT JOIN document_extractions e ON e.document_id = d.id
        WHERE d.id = ?
      `,
      )
      .get(docId) as Record<string, unknown>;

    const verificationResult = runCaseVerification(
      db,
      String(appRow.id),
      String(appRow.organization_id),
    );

    res.status(201).json({
      document: formatDocumentRow(docRow),
      pipeline,
      ...verificationResult,
    });
  });

  // 5. List Case Documents, Extractions, Verification Summary, Issues & Jobs
  router.get('/cases/:caseId/documents', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const existingVerif = db
      .prepare('SELECT id FROM document_verifications WHERE application_id = ?')
      .get(String(appRow.id));

    if (!existingVerif) {
      runCaseVerification(db, String(appRow.id), String(appRow.organization_id));
    }

    const requirements = syncChecklistForCase(
      db,
      String(appRow.id),
      String(appRow.organization_id),
    );

    const docRows = db
      .prepare(
        `
        SELECT d.*,
               u_up.full_name AS uploaded_by_name,
               u_rev.full_name AS reviewed_by_name,
               e.id AS extraction_id, e.ocr_provider, e.ai_provider, e.model_name, e.prompt_version,
               e.raw_ocr_text, e.detected_document_type, e.extracted_json, e.corrected_json,
               e.confidence_score, e.is_confirmed, e.confirmed_by_user_id, e.confirmed_at,
               e.ai_disclaimer, e.updated_at AS extraction_updated_at
        FROM application_documents d
        LEFT JOIN users u_up ON u_up.id = d.uploaded_by_user_id
        LEFT JOIN users u_rev ON u_rev.id = d.reviewed_by_user_id
        LEFT JOIN document_extractions e ON e.document_id = d.id
        WHERE d.application_id = ? AND d.organization_id = ?
        ORDER BY d.created_at DESC
      `,
      )
      .all(String(appRow.id), String(appRow.organization_id)) as Array<Record<string, unknown>>;

    const verification = db
      .prepare('SELECT * FROM document_verifications WHERE application_id = ? AND organization_id = ?')
      .get(String(appRow.id), String(appRow.organization_id));

    const issues = db
      .prepare(
        `
        SELECT vi.*, d.original_filename AS source_filename
        FROM verification_issues vi
        LEFT JOIN application_documents d ON d.id = vi.source_document_id
        WHERE vi.application_id = ? AND vi.organization_id = ?
        ORDER BY CASE vi.status WHEN 'OPEN' THEN 0 ELSE 1 END,
                 CASE vi.severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
                 vi.created_at DESC
      `,
      )
      .all(String(appRow.id), String(appRow.organization_id));

    const jobs = db
      .prepare(
        `
        SELECT * FROM processing_jobs
        WHERE application_id = ? AND organization_id = ?
        ORDER BY created_at DESC LIMIT 30
      `,
      )
      .all(String(appRow.id), String(appRow.organization_id));

    res.json({
      documents: docRows.map(formatDocumentRow),
      requirements,
      verification,
      issues,
      jobs,
    });
  });

  // 6. Generate Short-Lived Signed Download URL (Audited)
  router.get('/documents/:docId/download-url', requireAuth, (req, res) => {
    const docRow = authorizeDocumentAccess(db, req, res, req.params.docId);
    if (!docRow) return;

    if (docRow.malware_scan_status === 'QUARANTINED') {
      res.status(403).json({ error: 'Quarantined document cannot be downloaded' });
      return;
    }

    writeAuditLog(db, {
      organizationId: String(docRow.organization_id),
      actorUserId: req.auth!.userId,
      action: 'DOCUMENT_ACCESSED',
      resourceType: 'ApplicationDocument',
      resourceId: String(docRow.id),
      metadata: {
        applicationId: docRow.application_id,
        filename: docRow.original_filename,
      },
      ipAddress: req.ip,
    });

    if (isS3Configured()) {
      const expiresInSeconds = 300;
      const url = createS3PresignedUrl({
        method: 'GET',
        storageKey: String(docRow.storage_key),
        expiresInSeconds,
      });
      res.json({
        url,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      });
      return;
    }

    res.json(buildSignedDownloadPath(String(docRow.id), String(docRow.organization_id)));
  });

  // 7. Signed Private Storage Download Endpoint
  router.get('/storage/signed-download', (req, res) => {
    const docId = String(req.query.docId || '');
    const orgId = String(req.query.orgId || '');
    const exp = Number(req.query.exp || 0);
    const sig = String(req.query.sig || '');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';

    if (
      !verifyStorageToken({
        documentId: docId,
        organizationId: orgId,
        action: 'DOWNLOAD',
        expiresAtMs: exp,
        signature: sig,
      })
    ) {
      res.status(403).json({ error: 'Invalid or expired signed download token' });
      return;
    }

    const docRow = db
      .prepare('SELECT * FROM application_documents WHERE id = ? AND organization_id = ?')
      .get(docId, orgId) as Record<string, unknown> | undefined;

    if (!docRow) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (docRow.malware_scan_status === 'QUARANTINED') {
      res.status(403).json({ error: 'Quarantined file blocked from download' });
      return;
    }

    const buf = getPrivateObject(String(docRow.storage_key));
    if (!buf) {
      res.status(404).json({ error: 'Document binary missing from private storage' });
      return;
    }

    const safeFilename = String(docRow.original_filename).replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', String(docRow.mime_type));
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeFilename}"`);
    res.send(buf);
  });

  // 8. Re-run OCR & AI Extraction Job
  router.post('/documents/:docId/extract', requireAuth, async (req, res) => {
    const docRow = authorizeDocumentAccess(db, req, res, req.params.docId);
    if (!docRow) return;

    if (docRow.malware_scan_status === 'QUARANTINED') {
      res.status(400).json({ error: 'Cannot extract quarantined document' });
      return;
    }

    const extractJob = await enqueueAndExecuteJob(db, {
      queueName: QUEUE_DOCUMENT_PROCESSING,
      jobName: 'document.extract',
      organizationId: String(docRow.organization_id),
      applicationId: String(docRow.application_id),
      documentId: String(docRow.id),
      actorUserId: req.auth!.userId,
    });

    const verifyJob = await enqueueAndExecuteJob(db, {
      queueName: QUEUE_DOCUMENT_PROCESSING,
      jobName: 'case.verify-consistency',
      organizationId: String(docRow.organization_id),
      applicationId: String(docRow.application_id),
      actorUserId: req.auth!.userId,
    });

    writeAuditLog(db, {
      organizationId: String(docRow.organization_id),
      actorUserId: req.auth!.userId,
      action: 'DOCUMENT_EXTRACTION_RERUN',
      resourceType: 'ApplicationDocument',
      resourceId: String(docRow.id),
      ipAddress: req.ip,
    });

    res.json({ extractJob, verifyJob });
  });

  // 9. Manual Correction & Confirmation of Extracted Data (preserves raw_ocr_text & extracted_json)
  router.patch('/documents/:docId/extraction', requireAuth, (req, res) => {
    const docRow = authorizeDocumentAccess(db, req, res, req.params.docId);
    if (!docRow) return;

    const { fields, confirm, detectedDocumentType } = (req.body || {}) as {
      fields?: Record<string, string>;
      confirm?: boolean;
      detectedDocumentType?: string;
    };

    const existing = db
      .prepare('SELECT * FROM document_extractions WHERE document_id = ?')
      .get(String(docRow.id)) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Extraction record not found for document' });
      return;
    }

    const baseJson = JSON.parse(
      String(existing.corrected_json || existing.extracted_json || '{}'),
    ) as {
      fields?: Record<string, string>;
      fieldConfidences?: Record<string, number>;
      unreadableOrIncomplete?: boolean;
      missingPagesDetected?: boolean;
      readabilityNotes?: string;
      evidenceSnippets?: string[];
    };

    const sanitizedFields: Record<string, string> = {};
    if (fields && typeof fields === 'object') {
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string' && v.trim()) {
          sanitizedFields[k] = v.trim();
        }
      }
    }

    const updatedCorrected = {
      ...baseJson,
      fields: Object.keys(sanitizedFields).length > 0 ? sanitizedFields : baseJson.fields || {},
      manuallyEditedBy: req.auth!.userId,
      manuallyEditedAt: new Date().toISOString(),
    };

    const now = new Date().toISOString();
    const isConfirmed = Boolean(confirm) ? 1 : Number(existing.is_confirmed || 0);
    const confirmedBy = Boolean(confirm)
      ? req.auth!.userId
      : (existing.confirmed_by_user_id as string | null);
    const confirmedAt = Boolean(confirm) ? now : (existing.confirmed_at as string | null);

    db.prepare(`
      UPDATE document_extractions
      SET corrected_json = ?,
          detected_document_type = COALESCE(?, detected_document_type),
          is_confirmed = ?,
          confirmed_by_user_id = ?,
          confirmed_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(updatedCorrected),
      detectedDocumentType?.trim() || null,
      isConfirmed,
      confirmedBy,
      confirmedAt,
      now,
      String(existing.id),
    );

    if (updatedCorrected.fields?.expiryDate) {
      db.prepare('UPDATE application_documents SET expiry_date = ?, updated_at = ? WHERE id = ?').run(
        updatedCorrected.fields.expiryDate,
        now,
        String(docRow.id),
      );
    }

    const verificationResult = runCaseVerification(
      db,
      String(docRow.application_id),
      String(docRow.organization_id),
    );

    writeAuditLog(db, {
      organizationId: String(docRow.organization_id),
      actorUserId: req.auth!.userId,
      action: confirm ? 'DOCUMENT_EXTRACTION_CONFIRMED' : 'DOCUMENT_EXTRACTION_CORRECTED',
      resourceType: 'ApplicationDocument',
      resourceId: String(docRow.id),
      metadata: {
        correctedFieldKeys: Object.keys(sanitizedFields),
        confirmed: Boolean(confirm),
      },
      ipAddress: req.ip,
    });

    res.json({
      updated: true,
      corrected: updatedCorrected,
      isConfirmed: Boolean(isConfirmed),
      ...verificationResult,
    });
  });

  // 10. Explicit Case Cross-Document Verification Trigger
  router.post('/cases/:caseId/verify', requireAuth, async (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const job = await enqueueAndExecuteJob(db, {
      queueName: QUEUE_DOCUMENT_PROCESSING,
      jobName: 'case.verify-consistency',
      organizationId: String(appRow.organization_id),
      applicationId: String(appRow.id),
      actorUserId: req.auth!.userId,
    });

    res.json({
      job,
      ...(job.result as Record<string, unknown>),
    });
  });

  // 11. Consultant / Verification Officer Approval or Rejection
  router.patch(
    '/documents/:docId/review',
    requireAuth,
    requireRoles('VERIFICATION_OFFICER', 'CONSULTANT', 'AGENCY_ADMIN'),
    (req, res) => {
      const docRow = authorizeDocumentAccess(db, req, res, req.params.docId);
      if (!docRow) return;

      const { reviewStatus, reviewNotes } = (req.body || {}) as {
        reviewStatus?: 'VERIFIED' | 'NEEDS_CORRECTION' | 'REJECTED';
        reviewNotes?: string;
      };

      if (!reviewStatus || !['VERIFIED', 'NEEDS_CORRECTION', 'REJECTED'].includes(reviewStatus)) {
        res.status(400).json({ error: 'Valid reviewStatus required (VERIFIED, NEEDS_CORRECTION, REJECTED)' });
        return;
      }

      if (docRow.malware_scan_status === 'QUARANTINED' && reviewStatus === 'VERIFIED') {
        res.status(400).json({ error: 'Cannot approve a malware-quarantined document' });
        return;
      }

      if (
        (reviewStatus === 'NEEDS_CORRECTION' || reviewStatus === 'REJECTED') &&
        !reviewNotes?.trim()
      ) {
        res.status(400).json({ error: 'Review notes explaining the reason are required when requesting correction or rejecting' });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE application_documents
        SET review_status = ?, reviewed_by_user_id = ?, reviewed_at = ?, review_notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        reviewStatus,
        req.auth!.userId,
        now,
        reviewNotes?.trim() || null,
        now,
        String(docRow.id),
      );

      const verificationResult = runCaseVerification(
        db,
        String(docRow.application_id),
        String(docRow.organization_id),
      );

      writeAuditLog(db, {
        organizationId: String(docRow.organization_id),
        actorUserId: req.auth!.userId,
        action: 'DOCUMENT_REVIEWED',
        resourceType: 'ApplicationDocument',
        resourceId: String(docRow.id),
        metadata: {
          applicationId: docRow.application_id,
          reviewStatus,
          reviewNotes: reviewNotes?.trim() || null,
        },
        ipAddress: req.ip,
      });

      res.json({
        updated: true,
        reviewStatus,
        ...verificationResult,
      });
    },
  );

  // 12. Resolve / Override Verification Issue (Officer / Consultant / Admin)
  router.patch(
    '/verification-issues/:issueId',
    requireAuth,
    requireRoles('VERIFICATION_OFFICER', 'CONSULTANT', 'AGENCY_ADMIN'),
    (req, res) => {
      const issue = db
        .prepare('SELECT * FROM verification_issues WHERE id = ?')
        .get(req.params.issueId) as Record<string, unknown> | undefined;

      if (!issue) {
        res.status(404).json({ error: 'Verification issue not found' });
        return;
      }

      if (!req.auth!.isPlatformAdmin && String(issue.organization_id) !== req.auth!.organizationId) {
        res.status(403).json({ error: 'Forbidden: cross-tenant verification issue access denied' });
        return;
      }

      const { status, resolutionNote } = (req.body || {}) as {
        status?: 'RESOLVED' | 'OVERRIDDEN' | 'OPEN';
        resolutionNote?: string;
      };

      if (!status || !['RESOLVED', 'OVERRIDDEN', 'OPEN'].includes(status)) {
        res.status(400).json({ error: 'Valid status required (RESOLVED, OVERRIDDEN, OPEN)' });
        return;
      }

      db.prepare(`
        UPDATE verification_issues
        SET status = ?, resolved_by_user_id = ?, resolution_note = ?, updated_at = ?
        WHERE id = ?
      `).run(
        status,
        status === 'OPEN' ? null : req.auth!.userId,
        resolutionNote?.trim() || null,
        new Date().toISOString(),
        String(issue.id),
      );

      writeAuditLog(db, {
        organizationId: String(issue.organization_id),
        actorUserId: req.auth!.userId,
        action: 'VERIFICATION_ISSUE_UPDATED',
        resourceType: 'VerificationIssue',
        resourceId: String(issue.id),
        metadata: { status, resolutionNote: resolutionNote?.trim() || null },
        ipAddress: req.ip,
      });

      res.json({ updated: true, status });
    },
  );

  // 13. Verification Queue across tenant (Staff only)
  router.get(
    '/verification-queue',
    requireAuth,
    requireRoles('VERIFICATION_OFFICER', 'CONSULTANT', 'AGENCY_ADMIN'),
    (req, res) => {
      const tenantCondition = req.auth!.isPlatformAdmin ? '' : 'WHERE d.organization_id = ?';
      const params = req.auth!.isPlatformAdmin ? [] : [req.auth!.organizationId];

      const pendingDocuments = db
        .prepare(
          `
          SELECT d.id, d.application_id, d.document_type, d.original_filename, d.mime_type,
                 d.malware_scan_status, d.review_status, d.version, d.created_at,
                 a.reference_number, a.destination_country, a.visa_category,
                 u.full_name AS applicant_name,
                 e.confidence_score, e.detected_document_type, e.is_confirmed
          FROM application_documents d
          JOIN visa_applications a ON a.id = d.application_id
          JOIN users u ON u.id = a.applicant_user_id
          LEFT JOIN document_extractions e ON e.document_id = d.id
          ${tenantCondition}
          ORDER BY CASE d.review_status WHEN 'EXTRACTED' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'NEEDS_CORRECTION' THEN 2 ELSE 3 END, d.created_at DESC
        `,
        )
        .all(...params);

      const openIssuesWhere = req.auth!.isPlatformAdmin
        ? "WHERE vi.status = 'OPEN'"
        : "WHERE vi.organization_id = ? AND vi.status = 'OPEN'";
      const openIssues = db
        .prepare(
          `
          SELECT vi.*, a.reference_number, u.full_name AS applicant_name, d.original_filename AS source_filename
          FROM verification_issues vi
          JOIN visa_applications a ON a.id = vi.application_id
          JOIN users u ON u.id = a.applicant_user_id
          LEFT JOIN application_documents d ON d.id = vi.source_document_id
          ${openIssuesWhere}
          ORDER BY CASE vi.severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END, vi.created_at DESC
        `,
        )
        .all(...params);

      res.json({ pendingDocuments, openIssues });
    },
  );

  // 14. Processing Jobs Log
  router.get('/cases/:caseId/jobs', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const jobs = db
      .prepare(
        'SELECT * FROM processing_jobs WHERE application_id = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 30',
      )
      .all(String(appRow.id), String(appRow.organization_id));

    res.json({ jobs });
  });

  // 15. Delete unverified / quarantined document
  router.delete('/documents/:docId', requireAuth, (req, res) => {
    const docRow = authorizeDocumentAccess(db, req, res, req.params.docId);
    if (!docRow) return;

    if (
      req.auth!.role === 'APPLICANT' &&
      !req.auth!.isPlatformAdmin &&
      docRow.review_status === 'VERIFIED'
    ) {
      res.status(403).json({ error: 'Verified documents cannot be deleted by an applicant' });
      return;
    }

    db.prepare('DELETE FROM application_documents WHERE id = ?').run(String(docRow.id));
    const verificationResult = runCaseVerification(
      db,
      String(docRow.application_id),
      String(docRow.organization_id),
    );

    writeAuditLog(db, {
      organizationId: String(docRow.organization_id),
      actorUserId: req.auth!.userId,
      action: 'DOCUMENT_DELETED',
      resourceType: 'ApplicationDocument',
      resourceId: String(docRow.id),
      metadata: {
        applicationId: docRow.application_id,
        filename: docRow.original_filename,
      },
      ipAddress: req.ip,
    });

    res.json({ deleted: true, ...verificationResult });
  });

  return router;
}
