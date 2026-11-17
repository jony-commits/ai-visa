import { Request, Response, Router } from 'express';
import { AppDatabase, writeAuditLog } from '../db.ts';
import { requireAuth } from '../middleware.ts';
import {
  approveApplicationForm,
  generateAiFormSuggestions,
  getFormDetailPayload,
  prefillFormFromVerifiedData,
  renderExportHtmlSummary,
  resolveAiSuggestion,
  saveFormDraft,
} from '../services/formEngine.ts';
import { seedFormSchemas } from '../services/formSchemas.ts';
import {
  createSubmissionHandoff,
  listSubmissionCapabilities,
} from '../services/submissionAdapter.ts';

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
    res.status(403).json({ error: 'Forbidden: cross-tenant form access denied' });
    return null;
  }

  if (
    req.auth!.role === 'APPLICANT' &&
    !req.auth!.isPlatformAdmin &&
    String(appRow.applicant_user_id) !== req.auth!.userId
  ) {
    res.status(403).json({ error: 'Forbidden: applicants can only access forms on their own cases' });
    return null;
  }

  return appRow;
}

export function createFormsRouter(db: AppDatabase): Router {
  const router = Router();

  // 1. Versioned Schema Catalog
  router.get('/form-schemas', requireAuth, (req, res) => {
    seedFormSchemas(db);
    const schemas = req.auth!.isPlatformAdmin
      ? db
          .prepare(
            `
            SELECT id, organization_id, destination_country, visa_category_code, schema_key, version,
                   title, is_demo_rule, official_source_url, approval_status, created_at, approved_at
            FROM visa_form_schemas
            ORDER BY destination_country ASC, visa_category_code ASC, created_at DESC
          `,
          )
          .all()
      : db
          .prepare(
            `
            SELECT id, organization_id, destination_country, visa_category_code, schema_key, version,
                   title, is_demo_rule, official_source_url, approval_status, created_at, approved_at
            FROM visa_form_schemas
            WHERE (organization_id IS NULL OR organization_id = ?)
              AND (approval_status = 'PUBLISHED' OR ? != 'APPLICANT')
            ORDER BY CASE WHEN organization_id = ? THEN 0 ELSE 1 END, destination_country ASC, visa_category_code ASC, created_at DESC
          `,
          )
          .all(req.auth!.organizationId, req.auth!.role, req.auth!.organizationId);
    res.json({ schemas });
  });

  // 2. Get Dynamic Case Form, Schema, Revisions & Submission Handoff Status
  router.get('/cases/:caseId/forms', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const payload = getFormDetailPayload(
      db,
      String(appRow.id),
      String(appRow.organization_id),
      req.auth!.userId,
    );
    const submissionCapabilities = listSubmissionCapabilities(
      db,
      String(appRow.id),
      String(appRow.organization_id),
    );
    const handoffs = db
      .prepare(
        `
        SELECT h.*, u.full_name AS submitted_by_name
        FROM submission_handoffs h
        LEFT JOIN users u ON u.id = h.submitted_by_user_id
        WHERE h.application_id = ? AND h.organization_id = ?
        ORDER BY h.created_at DESC
      `,
      )
      .all(String(appRow.id), String(appRow.organization_id))
      .map((h: any) => ({
        ...h,
        handoffPackage: h.handoff_package_json ? JSON.parse(String(h.handoff_package_json)) : null,
      }));

    res.json({
      ...payload,
      submissionCapabilities,
      handoffs,
    });
  });

  // 3. Auto-save or Step-Save Draft
  router.put('/cases/:caseId/forms/draft', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const { answers, currentStep, isAutosave, changeReason } = (req.body || {}) as {
      answers?: Record<string, unknown>;
      currentStep?: number;
      isAutosave?: boolean;
      changeReason?: string;
    };

    const result = saveFormDraft(db, {
      applicationId: String(appRow.id),
      organizationId: String(appRow.organization_id),
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      answersPatch: answers || {},
      currentStep,
      isAutosave: Boolean(isAutosave),
      changeReason,
    });

    if (!isAutosave && result.changedKeys.length > 0) {
      writeAuditLog(db, {
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
        action: 'FORM_DRAFT_SAVED',
        resourceType: 'ApplicationForm',
        resourceId: result.detail.form.id,
        metadata: {
          applicationId: appRow.id,
          changedKeys: result.changedKeys,
          revisionNumber: result.detail.form.revisionNumber,
        },
        ipAddress: req.ip,
      });
    }

    res.json(result);
  });

  // 4. Prefill from Verified Applicant Profile, Encrypted Passport & Confirmed Extractions
  router.post('/cases/:caseId/forms/prefill', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const { overwriteExisting } = (req.body || {}) as { overwriteExisting?: boolean };
    const result = prefillFormFromVerifiedData(db, {
      applicationId: String(appRow.id),
      organizationId: String(appRow.organization_id),
      actorUserId: req.auth!.userId,
      overwriteExisting: Boolean(overwriteExisting),
    });

    writeAuditLog(db, {
      organizationId: String(appRow.organization_id),
      actorUserId: req.auth!.userId,
      action: 'FORM_PREFILLED_VERIFIED',
      resourceType: 'ApplicationForm',
      resourceId: result.detail.form.id,
      metadata: {
        applicationId: appRow.id,
        filledKeys: result.filledKeys,
      },
      ipAddress: req.ip,
    });

    res.json(result);
  });

  // 5. Generate AI Suggestions (Consent-Gated, Clearly Marked for Human Review)
  router.post('/cases/:caseId/forms/ai-suggest', requireAuth, async (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    try {
      const detail = await generateAiFormSuggestions(db, {
        applicationId: String(appRow.id),
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
      });

      writeAuditLog(db, {
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
        action: 'FORM_AI_SUGGESTIONS_GENERATED',
        resourceType: 'ApplicationForm',
        resourceId: detail.form.id,
        metadata: { applicationId: appRow.id },
        ipAddress: req.ip,
      });

      res.json(detail);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: err.message || 'AI suggestion generation failed' });
    }
  });

  // 6. Accept or Dismiss Individual AI Suggestion
  router.patch('/cases/:caseId/forms/ai-suggestions/:fieldKey', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const { decision, editedValue } = (req.body || {}) as {
      decision?: 'ACCEPT' | 'DISMISS';
      editedValue?: string;
    };

    if (!decision || !['ACCEPT', 'DISMISS'].includes(decision)) {
      res.status(400).json({ error: 'Valid decision required (ACCEPT or DISMISS)' });
      return;
    }

    try {
      const detail = resolveAiSuggestion(db, {
        applicationId: String(appRow.id),
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
        fieldKey: req.params.fieldKey,
        decision,
        editedValue,
      });

      writeAuditLog(db, {
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
        action: 'FORM_AI_SUGGESTION_REVIEWED',
        resourceType: 'ApplicationForm',
        resourceId: detail.form.id,
        metadata: {
          applicationId: appRow.id,
          fieldKey: req.params.fieldKey,
          decision,
        },
        ipAddress: req.ip,
      });

      res.json(detail);
    } catch (err: any) {
      res.status(404).json({ error: err.message || 'Suggestion not found' });
    }
  });

  // 7. Applicant Approval & Signed Declaration (Strictly Applicant-Owned)
  router.post('/cases/:caseId/forms/approve', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    // Consultants/Officers/Admins cannot forge an applicant's legal declaration
    if (
      String(appRow.applicant_user_id) !== req.auth!.userId &&
      !req.auth!.isPlatformAdmin
    ) {
      res.status(403).json({
        error:
          'Forbidden: only the case applicant can sign and approve the final visa application declaration.',
      });
      return;
    }

    const { attestationAccepted, attestationText } = (req.body || {}) as {
      attestationAccepted?: boolean;
      attestationText?: string;
    };

    if (!attestationAccepted) {
      res.status(400).json({
        error: 'Explicit applicant declaration acceptance (attestationAccepted: true) is required.',
      });
      return;
    }

    try {
      const detail = approveApplicationForm(db, {
        applicationId: String(appRow.id),
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
        attestationText:
          attestationText?.trim() ||
          'I confirm that all statements and supporting answers in this visa application form are accurate and truthful.',
      });

      writeAuditLog(db, {
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
        action: 'FORM_APPLICANT_APPROVED',
        resourceType: 'ApplicationForm',
        resourceId: detail.form.id,
        metadata: {
          applicationId: appRow.id,
          revisionNumber: detail.form.revisionNumber,
        },
        ipAddress: req.ip,
      });

      res.json(detail);
    } catch (err: any) {
      res.status(err.statusCode || 400).json({
        error: err.message || 'Form approval failed',
        fieldErrors: err.fieldErrors,
      });
    }
  });

  // 8. Export Form Package (JSON or Printable HTML Summary)
  router.get('/cases/:caseId/forms/export', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const format = String(req.query.format || 'json').toLowerCase();
    const detail = getFormDetailPayload(
      db,
      String(appRow.id),
      String(appRow.organization_id),
      req.auth!.userId,
    );

    writeAuditLog(db, {
      organizationId: String(appRow.organization_id),
      actorUserId: req.auth!.userId,
      action: 'FORM_EXPORTED',
      resourceType: 'ApplicationForm',
      resourceId: detail.form.id,
      metadata: { applicationId: appRow.id, format },
      ipAddress: req.ip,
    });

    if (format === 'html') {
      const html = renderExportHtmlSummary(detail, detail.schema);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="meridian-form-${String(appRow.reference_number)}.html"`,
      );
      res.send(html);
      return;
    }

    res.json({
      exportedAt: new Date().toISOString(),
      caseReference: appRow.reference_number,
      schema: {
        schemaKey: detail.schema.schemaKey,
        version: detail.schema.version,
        title: detail.schema.title,
        isDemoRule: detail.schema.isDemoRule,
      },
      form: detail.form,
      revisions: detail.revisions,
    });
  });

  // 9. Submission Capabilities & Handoffs
  router.get('/cases/:caseId/submission', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const capabilities = listSubmissionCapabilities(
      db,
      String(appRow.id),
      String(appRow.organization_id),
    );
    const handoffs = db
      .prepare(
        `
        SELECT h.*, u.full_name AS submitted_by_name
        FROM submission_handoffs h
        LEFT JOIN users u ON u.id = h.submitted_by_user_id
        WHERE h.application_id = ? AND h.organization_id = ?
        ORDER BY h.created_at DESC
      `,
      )
      .all(String(appRow.id), String(appRow.organization_id))
      .map((h: any) => ({
        ...h,
        handoffPackage: h.handoff_package_json ? JSON.parse(String(h.handoff_package_json)) : null,
      }));

    res.json({ capabilities, handoffs });
  });

  // 10. Create Submission Handoff (Authorized Official API or Guided Manual Handoff)
  router.post('/cases/:caseId/submission/handoff', requireAuth, async (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const { mode = 'GUIDED_MANUAL_HANDOFF' } = (req.body || {}) as { mode?: string };

    try {
      const handoff = await createSubmissionHandoff(db, {
        applicationId: String(appRow.id),
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
        mode,
      });

      writeAuditLog(db, {
        organizationId: String(appRow.organization_id),
        actorUserId: req.auth!.userId,
        action: 'SUBMISSION_HANDOFF_CREATED',
        resourceType: 'SubmissionHandoff',
        resourceId: handoff.handoffId,
        metadata: {
          applicationId: appRow.id,
          mode: handoff.mode,
          status: handoff.status,
        },
        ipAddress: req.ip,
      });

      res.status(201).json(handoff);
    } catch (err: any) {
      if (err.code === 'FORBIDDEN_PORTAL_AUTOMATION') {
        writeAuditLog(db, {
          organizationId: String(appRow.organization_id),
          actorUserId: req.auth!.userId,
          action: 'RESTRICTED_AUTOMATION_BLOCKED',
          resourceType: 'VisaApplication',
          resourceId: String(appRow.id),
          metadata: { requestedMode: mode },
          ipAddress: req.ip,
        });
      }
      res.status(err.statusCode || 400).json({ error: err.message || 'Submission handoff failed' });
    }
  });

  // 11. Confirm Manual External Portal Submission Reference (Honest Provenance)
  router.post('/cases/:caseId/submission/:handoffId/confirm-manual', requireAuth, (req, res) => {
    const appRow = authorizeCaseAccess(db, req, res, req.params.caseId);
    if (!appRow) return;

    const handoff = db
      .prepare('SELECT * FROM submission_handoffs WHERE id = ? AND application_id = ? AND organization_id = ?')
      .get(req.params.handoffId, String(appRow.id), String(appRow.organization_id)) as
      | Record<string, unknown>
      | undefined;

    if (!handoff) {
      res.status(404).json({ error: 'Submission handoff record not found' });
      return;
    }

    const { externalConfirmationRef, source } = (req.body || {}) as {
      externalConfirmationRef?: string;
      source?: 'CONSULTANT_MANUAL_UPDATE' | 'APPLICANT_UPLOADED_NOTICE';
    };

    if (!externalConfirmationRef?.trim()) {
      res.status(400).json({ error: 'External portal confirmation reference is required' });
      return;
    }

    const effectiveSource =
      req.auth!.role === 'APPLICANT'
        ? 'APPLICANT_UPLOADED_NOTICE'
        : source === 'APPLICANT_UPLOADED_NOTICE'
          ? 'APPLICANT_UPLOADED_NOTICE'
          : 'CONSULTANT_MANUAL_UPDATE';

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE submission_handoffs
      SET status = 'CONFIRMED_MANUALLY',
          external_confirmation_ref = ?,
          submitted_by_user_id = ?,
          submitted_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(externalConfirmationRef.trim(), req.auth!.userId, now, now, String(handoff.id));

    db.prepare(`
      UPDATE visa_applications
      SET government_status = 'Submitted Externally (Manual Receipt Recorded)',
          government_status_source = ?,
          government_tracking_ref = ?,
          updated_at = ?
      WHERE id = ?
    `).run(effectiveSource, externalConfirmationRef.trim(), now, String(appRow.id));

    writeAuditLog(db, {
      organizationId: String(appRow.organization_id),
      actorUserId: req.auth!.userId,
      action: 'MANUAL_SUBMISSION_CONFIRMED',
      resourceType: 'SubmissionHandoff',
      resourceId: String(handoff.id),
      metadata: {
        applicationId: appRow.id,
        externalConfirmationRef: externalConfirmationRef.trim(),
        source: effectiveSource,
      },
      ipAddress: req.ip,
    });

    res.json({
      confirmed: true,
      externalConfirmationRef: externalConfirmationRef.trim(),
      governmentStatusSource: effectiveSource,
    });
  });

  return router;
}
