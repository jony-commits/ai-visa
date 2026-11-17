import { Router } from 'express';
import { AppDatabase } from '../db.ts';
import { requireAuth, requireRoles } from '../middleware.ts';
import { hasLiveGeminiKey } from '../services/aiProvider.ts';

const TERMINAL_STATUSES = new Set(['APPROVED', 'REJECTED', 'WITHDRAWN', 'CLOSED']);
const DECIDED_STATUSES = new Set([
  'SUBMITTED',
  'AWAITING_APPOINTMENT_DECISION',
  'DECISION_RECEIVED',
  'APPROVED',
  'REJECTED',
  'CLOSED',
]);

export function createAnalyticsRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/analytics/overview', requireAuth, (req, res) => {
    const requestedPlatformScope =
      req.query.scope === 'platform' && req.auth!.isPlatformAdmin;
    const isApplicant = req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin;
    const isStaff = !isApplicant;

    const nowMs = Date.now();
    const in48hMs = nowMs + 48 * 60 * 60 * 1000;
    const nowIso = new Date(nowMs).toISOString();

    const caseConditions: string[] = [];
    const caseParams: Array<string | number> = [];

    if (!requestedPlatformScope) {
      caseConditions.push('a.organization_id = ?');
      caseParams.push(req.auth!.organizationId);
    }
    if (isApplicant) {
      caseConditions.push('a.applicant_user_id = ?');
      caseParams.push(req.auth!.userId);
    }
    const caseWhere = caseConditions.length > 0 ? `WHERE ${caseConditions.join(' AND ')}` : '';

    const caseRows = db
      .prepare(
        `
        SELECT
          a.id,
          a.reference_number,
          a.organization_id,
          o.name AS organization_name,
          a.applicant_user_id,
          u_app.full_name AS applicant_name,
          a.assigned_consultant_id,
          u_con.full_name AS consultant_name,
          a.destination_country,
          a.visa_category,
          a.internal_status,
          a.government_status,
          a.government_status_source,
          a.government_status_verified_at,
          a.stage_due_at,
          a.target_submission_deadline,
          a.created_at,
          a.updated_at
        FROM visa_applications a
        JOIN organizations o ON o.id = a.organization_id
        JOIN users u_app ON u_app.id = a.applicant_user_id
        LEFT JOIN users u_con ON u_con.id = a.assigned_consultant_id
        ${caseWhere}
        ORDER BY a.updated_at DESC
      `,
      )
      .all(...caseParams) as Array<Record<string, unknown>>;

    let activeCases = 0;
    let pendingApplicantAction = 0;
    let inReviewOrReady = 0;
    let submittedOrDecided = 0;
    let unassignedCases = 0;
    let assignedToMeCount = 0;
    let overdueSlaCount = 0;
    let dueWithin48hCount = 0;
    let turnaroundSumHours = 0;
    let turnaroundCount = 0;

    const stageMap = new Map<
      string,
      { stageCode: string; count: number; overdueCount: number; ageSumHours: number }
    >();

    const priorityCases: Array<{
      id: string;
      referenceNumber: string;
      applicantName: string;
      destinationCountry: string;
      visaCategory: string;
      internalStatus: string;
      consultantName: string | null;
      stageDueAt: string | null;
      targetSubmissionDeadline: string | null;
      slaState: 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'UNSET';
      actionReason: string;
    }> = [];

    for (const row of caseRows) {
      const status = String(row.internal_status);
      const isTerminal = TERMINAL_STATUSES.has(status);
      if (!isTerminal) activeCases += 1;

      if (
        [
          'APPLICANT_INFO_PENDING',
          'DOCUMENT_COLLECTION',
          'ADDITIONAL_INFO_REQUESTED',
          'RETURNED_FOR_CORRECTION',
          'APPLICANT_APPROVAL',
        ].includes(status)
      ) {
        pendingApplicantAction += 1;
      }

      if (['DOCUMENT_VERIFICATION', 'FORM_PREPARATION', 'CONSULTANT_REVIEW', 'READY_FOR_SUBMISSION'].includes(status)) {
        inReviewOrReady += 1;
      }

      if (DECIDED_STATUSES.has(status)) {
        submittedOrDecided += 1;
        const createdMs = new Date(String(row.created_at)).getTime();
        const updatedMs = new Date(String(row.updated_at)).getTime();
        if (Number.isFinite(createdMs) && Number.isFinite(updatedMs) && updatedMs >= createdMs) {
          turnaroundSumHours += (updatedMs - createdMs) / 3_600_000;
          turnaroundCount += 1;
        }
      }

      if (!row.assigned_consultant_id && !isTerminal) {
        unassignedCases += 1;
      }
      if (row.assigned_consultant_id === req.auth!.userId) {
        assignedToMeCount += 1;
      }

      const stageDueStr = row.stage_due_at ? String(row.stage_due_at) : null;
      const stageDueMs = stageDueStr ? new Date(stageDueStr).getTime() : NaN;
      let slaState: 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'UNSET' = 'UNSET';
      if (!isTerminal && Number.isFinite(stageDueMs)) {
        if (stageDueMs < nowMs) {
          slaState = 'OVERDUE';
          overdueSlaCount += 1;
        } else if (stageDueMs <= in48hMs) {
          slaState = 'DUE_SOON';
          dueWithin48hCount += 1;
        } else {
          slaState = 'ON_TRACK';
        }
      } else if (isTerminal) {
        slaState = 'ON_TRACK';
      }

      const ageHours = Math.max(
        0,
        (nowMs - new Date(String(row.updated_at)).getTime()) / 3_600_000,
      );
      const stageEntry = stageMap.get(status) || {
        stageCode: status,
        count: 0,
        overdueCount: 0,
        ageSumHours: 0,
      };
      stageEntry.count += 1;
      if (slaState === 'OVERDUE') stageEntry.overdueCount += 1;
      stageEntry.ageSumHours += Number.isFinite(ageHours) ? ageHours : 0;
      stageMap.set(status, stageEntry);

      if (!isTerminal) {
        const needsPriority =
          slaState === 'OVERDUE' ||
          slaState === 'DUE_SOON' ||
          (!row.assigned_consultant_id && isStaff) ||
          (isApplicant &&
            [
              'APPLICANT_INFO_PENDING',
              'DOCUMENT_COLLECTION',
              'ADDITIONAL_INFO_REQUESTED',
              'RETURNED_FOR_CORRECTION',
              'APPLICANT_APPROVAL',
            ].includes(status)) ||
          (!isApplicant &&
            ['DOCUMENT_VERIFICATION', 'CONSULTANT_REVIEW', 'READY_FOR_SUBMISSION'].includes(status));

        if (needsPriority) {
          let actionReason = 'In active workflow queue';
          if (slaState === 'OVERDUE') actionReason = 'Stage SLA overdue';
          else if (slaState === 'DUE_SOON') actionReason = 'Stage SLA due within 48 hours';
          else if (!row.assigned_consultant_id && isStaff) actionReason = 'Unassigned — needs consultant';
          else if (status === 'APPLICANT_APPROVAL') actionReason = 'Awaiting applicant declaration sign-off';
          else if (status === 'RETURNED_FOR_CORRECTION' || status === 'ADDITIONAL_INFO_REQUESTED') {
            actionReason = 'Corrections or extra documents requested';
          } else if (status === 'DOCUMENT_VERIFICATION') actionReason = 'Pending verification officer sign-off';
          else if (status === 'CONSULTANT_REVIEW') actionReason = 'Ready for consultant review';
          else if (status === 'READY_FOR_SUBMISSION') actionReason = 'Approved and ready for filing handoff';

          priorityCases.push({
            id: String(row.id),
            referenceNumber: String(row.reference_number),
            applicantName: String(row.applicant_name),
            destinationCountry: String(row.destination_country),
            visaCategory: String(row.visa_category),
            internalStatus: status,
            consultantName: row.consultant_name ? String(row.consultant_name) : null,
            stageDueAt: stageDueStr,
            targetSubmissionDeadline: row.target_submission_deadline
              ? String(row.target_submission_deadline)
              : null,
            slaState,
            actionReason,
          });
        }
      }
    }

    priorityCases.sort((a, b) => {
      const rank = { OVERDUE: 0, DUE_SOON: 1, ON_TRACK: 2, UNSET: 3 };
      return rank[a.slaState] - rank[b.slaState];
    });

    const stageBreakdown = Array.from(stageMap.values())
      .map((item) => ({
        stageCode: item.stageCode,
        count: item.count,
        overdueCount: item.overdueCount,
        avgAgeHours: item.count > 0 ? Math.round((item.ageSumHours / item.count) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Document, task, appointment & queue scoped counts
    const tenantScopeWhere = requestedPlatformScope ? '' : 'WHERE organization_id = ?';
    const tenantScopeParams = requestedPlatformScope ? [] : [req.auth!.organizationId];

    let pendingDocumentsCount = 0;
    let openVerificationIssuesCount = 0;
    let quarantinedDocsCount = 0;
    let openTasksCount = 0;

    if (isApplicant) {
      const docCounts = db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN d.review_status IN ('PENDING', 'EXTRACTED', 'NEEDS_CORRECTION') THEN 1 ELSE 0 END) AS pending_docs,
            SUM(CASE WHEN d.malware_scan_status = 'QUARANTINED' THEN 1 ELSE 0 END) AS quarantined_docs
          FROM application_documents d
          JOIN visa_applications a ON a.id = d.application_id
          WHERE d.organization_id = ? AND a.applicant_user_id = ?
        `,
        )
        .get(req.auth!.organizationId, req.auth!.userId) as
        | { pending_docs: number | null; quarantined_docs: number | null }
        | undefined;
      pendingDocumentsCount = Number(docCounts?.pending_docs || 0);
      quarantinedDocsCount = Number(docCounts?.quarantined_docs || 0);

      const issRow = db
        .prepare(
          `
          SELECT COUNT(*) AS cnt
          FROM verification_issues vi
          JOIN visa_applications a ON a.id = vi.application_id
          WHERE vi.organization_id = ? AND a.applicant_user_id = ? AND vi.status = 'OPEN'
        `,
        )
        .get(req.auth!.organizationId, req.auth!.userId) as { cnt: number };
      openVerificationIssuesCount = Number(issRow.cnt || 0);

      const taskRow = db
        .prepare(
          `
          SELECT COUNT(*) AS cnt
          FROM case_tasks t
          JOIN visa_applications a ON a.id = t.application_id
          WHERE t.organization_id = ? AND a.applicant_user_id = ? AND t.status != 'COMPLETED'
        `,
        )
        .get(req.auth!.organizationId, req.auth!.userId) as { cnt: number };
      openTasksCount = Number(taskRow.cnt || 0);
    } else {
      const docCounts = db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN review_status IN ('PENDING', 'EXTRACTED', 'NEEDS_CORRECTION') THEN 1 ELSE 0 END) AS pending_docs,
            SUM(CASE WHEN malware_scan_status = 'QUARANTINED' THEN 1 ELSE 0 END) AS quarantined_docs
          FROM application_documents
          ${tenantScopeWhere}
        `,
        )
        .get(...tenantScopeParams) as
        | { pending_docs: number | null; quarantined_docs: number | null }
        | undefined;
      pendingDocumentsCount = Number(docCounts?.pending_docs || 0);
      quarantinedDocsCount = Number(docCounts?.quarantined_docs || 0);

      const issWhere = requestedPlatformScope
        ? "WHERE status = 'OPEN'"
        : "WHERE organization_id = ? AND status = 'OPEN'";
      const issRow = db
        .prepare(`SELECT COUNT(*) AS cnt FROM verification_issues ${issWhere}`)
        .get(...tenantScopeParams) as { cnt: number };
      openVerificationIssuesCount = Number(issRow.cnt || 0);

      const taskWhere = requestedPlatformScope
        ? "WHERE status != 'COMPLETED'"
        : "WHERE organization_id = ? AND status != 'COMPLETED'";
      const taskRow = db
        .prepare(`SELECT COUNT(*) AS cnt FROM case_tasks ${taskWhere}`)
        .get(...tenantScopeParams) as { cnt: number };
      openTasksCount = Number(taskRow.cnt || 0);
    }

    const upcomingAppointments = isApplicant
      ? db
          .prepare(
            `
            SELECT ca.*, a.reference_number, u_app.full_name AS applicant_name
            FROM case_appointments ca
            JOIN visa_applications a ON a.id = ca.application_id
            JOIN users u_app ON u_app.id = a.applicant_user_id
            WHERE ca.organization_id = ? AND a.applicant_user_id = ?
              AND ca.status IN ('SCHEDULED', 'RESCHEDULED') AND ca.scheduled_at >= ?
            ORDER BY ca.scheduled_at ASC LIMIT 8
          `,
          )
          .all(req.auth!.organizationId, req.auth!.userId, nowIso)
      : db
          .prepare(
            `
            SELECT ca.*, a.reference_number, u_app.full_name AS applicant_name
            FROM case_appointments ca
            JOIN visa_applications a ON a.id = ca.application_id
            JOIN users u_app ON u_app.id = a.applicant_user_id
            WHERE ${requestedPlatformScope ? '1=1' : 'ca.organization_id = ?'}
              AND ca.status IN ('SCHEDULED', 'RESCHEDULED') AND ca.scheduled_at >= ?
            ORDER BY ca.scheduled_at ASC LIMIT 8
          `,
          )
          .all(...(requestedPlatformScope ? [nowIso] : [req.auth!.organizationId, nowIso]));

    // Consultant workload (staff & admin)
    let consultantWorkload: Array<{
      userId: string;
      fullName: string;
      role: string;
      activeCount: number;
      overdueCount: number;
      dueSoonCount: number;
    }> = [];

    if (isStaff && !requestedPlatformScope) {
      const staffMembers = db
        .prepare(
          `
          SELECT u.id AS user_id, u.full_name, m.role
          FROM organization_members m
          JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = ? AND m.status = 'ACTIVE'
            AND m.role IN ('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER')
          ORDER BY u.full_name ASC
        `,
        )
        .all(req.auth!.organizationId) as Array<{
        user_id: string;
        full_name: string;
        role: string;
      }>;

      consultantWorkload = staffMembers.map((staff) => {
        const assignedCases = caseRows.filter(
          (c) =>
            c.assigned_consultant_id === staff.user_id &&
            !TERMINAL_STATUSES.has(String(c.internal_status)),
        );
        let overdue = 0;
        let dueSoon = 0;
        for (const c of assignedCases) {
          const dueMs = c.stage_due_at ? new Date(String(c.stage_due_at)).getTime() : NaN;
          if (Number.isFinite(dueMs)) {
            if (dueMs < nowMs) overdue += 1;
            else if (dueMs <= in48hMs) dueSoon += 1;
          }
        }
        return {
          userId: staff.user_id,
          fullName: staff.full_name,
          role: staff.role,
          activeCount: assignedCases.length,
          overdueCount: overdue,
          dueSoonCount: dueSoon,
        };
      });
    }

    // Queue & Notification health (staff only)
    let notificationDelivery = {
      scheduled: 0,
      retryWait: 0,
      delivered: 0,
      failedPermanent: 0,
      skippedNoConsent: 0,
    };
    let processingJobs = {
      queued: 0,
      active: 0,
      completed: 0,
      failed: 0,
    };

    if (isStaff) {
      const notifRows = db
        .prepare(
          `SELECT status, COUNT(*) AS cnt FROM notification_jobs ${tenantScopeWhere} GROUP BY status`,
        )
        .all(...tenantScopeParams) as Array<{ status: string; cnt: number }>;
      for (const r of notifRows) {
        if (r.status === 'SCHEDULED') notificationDelivery.scheduled = Number(r.cnt);
        if (r.status === 'RETRY_WAIT') notificationDelivery.retryWait = Number(r.cnt);
        if (r.status === 'DELIVERED') notificationDelivery.delivered = Number(r.cnt);
        if (r.status === 'FAILED_PERMANENT') notificationDelivery.failedPermanent = Number(r.cnt);
        if (r.status === 'SKIPPED_NO_CONSENT') notificationDelivery.skippedNoConsent = Number(r.cnt);
      }

      const jobRows = db
        .prepare(
          `SELECT status, COUNT(*) AS cnt FROM processing_jobs ${tenantScopeWhere} GROUP BY status`,
        )
        .all(...tenantScopeParams) as Array<{ status: string; cnt: number }>;
      for (const r of jobRows) {
        if (r.status === 'QUEUED') processingJobs.queued = Number(r.cnt);
        if (r.status === 'ACTIVE') processingJobs.active = Number(r.cnt);
        if (r.status === 'COMPLETED') processingJobs.completed = Number(r.cnt);
        if (r.status === 'FAILED') processingJobs.failed = Number(r.cnt);
      }
    }

    // Applicant summary if applicant
    let applicantSummary: {
      onboardingCompleted: boolean;
      consentPersonal: boolean;
      consentAi: boolean;
      consentComms: boolean;
      missingMandatoryDocsCount: number;
      unapprovedCompleteFormsCount: number;
    } | null = null;

    if (isApplicant) {
      const profile = db
        .prepare(
          'SELECT onboarding_completed FROM applicant_profiles WHERE user_id = ? AND organization_id = ?',
        )
        .get(req.auth!.userId, req.auth!.organizationId) as
        | { onboarding_completed: number }
        | undefined;

      const consentRows = db
        .prepare(
          `
          SELECT consent_type, granted
          FROM applicant_consents
          WHERE user_id = ? AND organization_id = ?
          ORDER BY granted_at DESC
        `,
        )
        .all(req.auth!.userId, req.auth!.organizationId) as Array<{
        consent_type: string;
        granted: number;
      }>;
      const seenConsents = new Map<string, boolean>();
      for (const cr of consentRows) {
        if (!seenConsents.has(cr.consent_type)) {
          seenConsents.set(cr.consent_type, Boolean(cr.granted));
        }
      }

      const missingDocsRow = db
        .prepare(
          `
          SELECT COUNT(*) AS cnt
          FROM document_requirements dr
          JOIN visa_applications a ON a.id = dr.application_id
          WHERE dr.organization_id = ? AND a.applicant_user_id = ?
            AND dr.is_mandatory = 1 AND dr.status IN ('MISSING', 'NEEDS_CORRECTION', 'REJECTED')
        `,
        )
        .get(req.auth!.organizationId, req.auth!.userId) as { cnt: number };

      const unapprovedFormRow = db
        .prepare(
          `
          SELECT COUNT(*) AS cnt
          FROM application_forms af
          JOIN visa_applications a ON a.id = af.application_id
          WHERE af.organization_id = ? AND a.applicant_user_id = ?
            AND af.is_complete = 1 AND af.applicant_approved = 0
        `,
        )
        .get(req.auth!.organizationId, req.auth!.userId) as { cnt: number };

      applicantSummary = {
        onboardingCompleted: Boolean(profile?.onboarding_completed),
        consentPersonal: seenConsents.get('PERSONAL_DATA_PROCESSING') ?? false,
        consentAi: seenConsents.get('EXTERNAL_AI_PROCESSING') ?? false,
        consentComms: seenConsents.get('COMMUNICATIONS') ?? false,
        missingMandatoryDocsCount: Number(missingDocsRow.cnt || 0),
        unapprovedCompleteFormsCount: Number(unapprovedFormRow.cnt || 0),
      };
    }

    res.json({
      scope: requestedPlatformScope ? 'platform' : 'tenant',
      role: req.auth!.role,
      isPlatformAdmin: req.auth!.isPlatformAdmin,
      summary: {
        totalCases: caseRows.length,
        activeCases,
        pendingApplicantAction,
        inReviewOrReady,
        submittedOrDecided,
        unassignedCases,
        assignedToMeCount,
        overdueSlaCount,
        dueWithin48hCount,
        avgTurnaroundHours:
          turnaroundCount > 0 ? Math.round((turnaroundSumHours / turnaroundCount) * 10) / 10 : null,
        hasCompletedCases: turnaroundCount > 0,
        openTasksCount,
        upcomingAppointmentsCount: upcomingAppointments.length,
        pendingDocumentsCount,
        openVerificationIssuesCount,
        quarantinedDocsCount,
      },
      stageBreakdown,
      priorityCases: priorityCases.slice(0, 12),
      consultantWorkload,
      upcomingAppointments,
      notificationDelivery,
      processingJobs,
      applicantSummary,
    });
  });

  router.get(
    '/analytics/ai-usage',
    requireAuth,
    requireRoles('AGENCY_ADMIN', 'VERIFICATION_OFFICER', 'CONSULTANT'),
    (req, res) => {
      const requestedPlatformScope =
        req.query.scope === 'platform' && req.auth!.isPlatformAdmin;
      const whereClause = requestedPlatformScope ? '' : 'WHERE l.organization_id = ?';
      const params = requestedPlatformScope ? [] : [req.auth!.organizationId];

      const totalsRow = db
        .prepare(
          `
          SELECT
            COUNT(*) AS total_calls,
            SUM(CASE WHEN l.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN l.status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
            COALESCE(SUM(l.input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(l.output_tokens), 0) AS total_output_tokens
          FROM ai_usage_logs l
          ${whereClause}
        `,
        )
        .get(...params) as Record<string, number | null>;

      const byModel = db
        .prepare(
          `
          SELECT
            l.provider,
            l.model,
            l.prompt_version,
            COUNT(*) AS call_count,
            SUM(CASE WHEN l.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN l.status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
            COALESCE(SUM(l.input_tokens), 0) AS input_tokens,
            COALESCE(SUM(l.output_tokens), 0) AS output_tokens
          FROM ai_usage_logs l
          ${whereClause}
          GROUP BY l.provider, l.model, l.prompt_version
          ORDER BY call_count DESC
        `,
        )
        .all(...params);

      const extWhere = requestedPlatformScope ? '' : 'WHERE organization_id = ?';
      const extractionBreakdown = db
        .prepare(
          `
          SELECT
            ai_provider,
            model_name,
            COUNT(*) AS document_count,
            SUM(CASE WHEN is_confirmed = 1 THEN 1 ELSE 0 END) AS confirmed_count,
            ROUND(AVG(confidence_score), 2) AS avg_confidence
          FROM document_extractions
          ${extWhere}
          GROUP BY ai_provider, model_name
          ORDER BY document_count DESC
        `,
        )
        .all(...params);

      const byOrganization = requestedPlatformScope
        ? db
            .prepare(
              `
              SELECT
                o.id AS organization_id,
                o.name AS organization_name,
                COUNT(l.id) AS call_count,
                SUM(CASE WHEN l.status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
                COALESCE(SUM(l.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(l.output_tokens), 0) AS output_tokens
              FROM organizations o
              LEFT JOIN ai_usage_logs l ON l.organization_id = o.id
              GROUP BY o.id, o.name
              ORDER BY call_count DESC, o.name ASC
            `,
            )
            .all()
        : [];

      const recentLogs = db
        .prepare(
          `
          SELECT
            l.*,
            u.full_name AS actor_name,
            u.email AS actor_email,
            a.reference_number,
            o.name AS organization_name
          FROM ai_usage_logs l
          LEFT JOIN users u ON u.id = l.user_id
          LEFT JOIN visa_applications a ON a.id = l.application_id
          LEFT JOIN organizations o ON o.id = l.organization_id
          ${whereClause}
          ORDER BY l.created_at DESC
          LIMIT 30
        `,
        )
        .all(...params);

      const totalCalls = Number(totalsRow?.total_calls || 0);
      const inputTokens = Number(totalsRow?.total_input_tokens || 0);
      const outputTokens = Number(totalsRow?.total_output_tokens || 0);

      res.json({
        scope: requestedPlatformScope ? 'platform' : 'tenant',
        geminiConfigured: hasLiveGeminiKey(),
        totals: {
          totalCalls,
          successCount: Number(totalsRow?.success_count || 0),
          failedCount: Number(totalsRow?.failed_count || 0),
          totalInputTokens: inputTokens,
          totalOutputTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        byModel,
        extractionBreakdown,
        byOrganization,
        recentLogs,
      });
    },
  );

  return router;
}
