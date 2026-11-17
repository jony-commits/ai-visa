import { Router } from 'express';
import { AppDatabase, newId, writeAuditLog } from '../db.ts';
import { requireAuth, requireRoles } from '../middleware.ts';
import {
  listCaseNotifications,
  listNotificationTemplates,
  NotificationChannel,
  NotificationTemplateKey,
  processNotificationWorker,
  scheduleCaseEventNotifications,
  upsertOrgNotificationTemplate,
} from '../services/notifications.ts';
import {
  listStatusTrackingOverview,
  recordManualVerifiedStatusEvent,
  syncStatusFromAuthorizedApi,
} from '../services/statusAdapter.ts';
import {
  AuthContext,
  GovernmentStatusSource,
  INTERNAL_CASE_STATUSES,
  InternalCaseStatus,
} from '../types.ts';
import { getOrgWorkflowStages, updateOrgWorkflowStage } from '../workflow.ts';

const APPOINTMENT_TYPES = [
  'BIOMETRICS',
  'CONSULATE_INTERVIEW',
  'MEDICAL_EXAM',
  'PASSPORT_COLLECTION',
] as const;

const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'RESCHEDULED',
  'COMPLETED',
  'CANCELLED',
] as const;

function loadAuthorizedCase(
  db: AppDatabase,
  caseId: string,
  auth: AuthContext,
): Record<string, unknown> {
  const appRow = db
    .prepare('SELECT * FROM visa_applications WHERE id = ?')
    .get(caseId) as Record<string, unknown> | undefined;

  if (!appRow) {
    const err = new Error('Visa application not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  if (!auth.isPlatformAdmin && String(appRow.organization_id) !== auth.organizationId) {
    const err = new Error('Forbidden: cross-tenant access denied') as Error & {
      statusCode?: number;
    };
    err.statusCode = 403;
    throw err;
  }

  if (
    auth.role === 'APPLICANT' &&
    !auth.isPlatformAdmin &&
    String(appRow.applicant_user_id) !== auth.userId
  ) {
    const err = new Error('Forbidden: applicants can only access their own cases') as Error & {
      statusCode?: number;
    };
    err.statusCode = 403;
    throw err;
  }

  return appRow;
}

function syncNextCaseAppointment(
  db: AppDatabase,
  applicationId: string,
  organizationId: string,
): void {
  const upcoming = db
    .prepare(
      `
      SELECT scheduled_at FROM case_appointments
      WHERE application_id = ? AND organization_id = ?
        AND status IN ('SCHEDULED', 'RESCHEDULED')
      ORDER BY scheduled_at ASC
      LIMIT 1
    `,
    )
    .get(applicationId, organizationId) as { scheduled_at: string } | undefined;

  db.prepare('UPDATE visa_applications SET appointment_at = ?, updated_at = ? WHERE id = ?').run(
    upcoming ? upcoming.scheduled_at : null,
    new Date().toISOString(),
    applicationId,
  );
}

export function createWorkflowTrackingRouter(db: AppDatabase): Router {
  const router = Router();

  // 1. Configurable Organization Workflow Stages
  router.get('/workflows/stages', requireAuth, (req, res) => {
    const visaCategory =
      typeof req.query.visaCategory === 'string' && req.query.visaCategory.trim()
        ? req.query.visaCategory.trim()
        : '*';
    const stages = getOrgWorkflowStages(db, req.auth!.organizationId, visaCategory);
    res.json({ stages });
  });

  router.patch(
    '/workflows/stages/:stageCode',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const stageCode = req.params.stageCode as InternalCaseStatus;
      if (!INTERNAL_CASE_STATUSES.includes(stageCode)) {
        res.status(400).json({ error: `Invalid stage code "${stageCode}"` });
        return;
      }

      const {
        visaCategory,
        displayLabel,
        slaHours,
        enabled,
        allowedNextStages,
        applicantAllowed,
        notifyOnEnter,
      } = req.body as {
        visaCategory?: string;
        displayLabel?: string;
        slaHours?: number;
        enabled?: boolean;
        allowedNextStages?: InternalCaseStatus[];
        applicantAllowed?: boolean;
        notifyOnEnter?: boolean;
      };

      try {
        const stages = updateOrgWorkflowStage(db, {
          organizationId: req.auth!.organizationId,
          visaCategory: visaCategory?.trim() || '*',
          stageCode,
          displayLabel,
          slaHours,
          enabled,
          allowedNextStages,
          applicantAllowed,
          notifyOnEnter,
          updatedByUserId: req.auth!.userId,
        });

        writeAuditLog(db, {
          organizationId: req.auth!.organizationId,
          actorUserId: req.auth!.userId,
          action: 'WORKFLOW_STAGE_UPDATED',
          resourceType: 'OrganizationWorkflowStage',
          resourceId: stageCode,
          metadata: {
            visaCategory: visaCategory || '*',
            displayLabel,
            slaHours,
            enabled,
            allowedNextStages,
            applicantAllowed,
            notifyOnEnter,
          },
          ipAddress: req.ip,
        });

        res.json({ stages });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Unable to update workflow stage' });
      }
    },
  );

  // 2. Deadlines & SLA Management
  router.patch(
    '/cases/:id/deadlines',
    requireAuth,
    requireRoles('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      try {
        const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
        const { targetSubmissionDeadline, stageDueAt, scheduleReminder, reminderScheduledFor } =
          req.body as {
            targetSubmissionDeadline?: string | null;
            stageDueAt?: string | null;
            scheduleReminder?: boolean;
            reminderScheduledFor?: string | null;
          };

        const now = new Date().toISOString();
        const nextTarget =
          targetSubmissionDeadline === undefined
            ? (appRow.target_submission_deadline as string | null)
            : targetSubmissionDeadline?.trim() || null;
        const nextStageDue =
          stageDueAt === undefined
            ? (appRow.stage_due_at as string | null)
            : stageDueAt?.trim() || null;

        db.prepare(`
          UPDATE visa_applications
          SET target_submission_deadline = ?, stage_due_at = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `).run(nextTarget, nextStageDue, now, String(appRow.id), String(appRow.organization_id));

        writeAuditLog(db, {
          organizationId: String(appRow.organization_id),
          actorUserId: req.auth!.userId,
          action: 'CASE_DEADLINES_UPDATED',
          resourceType: 'VisaApplication',
          resourceId: String(appRow.id),
          metadata: { targetSubmissionDeadline: nextTarget, stageDueAt: nextStageDue },
          ipAddress: req.ip,
        });

        let scheduledNotifications = [] as ReturnType<typeof scheduleCaseEventNotifications>;
        if (scheduleReminder) {
          scheduledNotifications = scheduleCaseEventNotifications(db, {
            applicationId: String(appRow.id),
            organizationId: String(appRow.organization_id),
            templateKey: 'DEADLINE_REMINDER',
            variables: {
              targetDeadline: nextTarget || 'Unset',
              stageDueAt: nextStageDue || 'Unset',
            },
            includeConsultant: true,
            scheduledFor: reminderScheduledFor?.trim() || undefined,
            actorUserId: req.auth!.userId,
          });
        }

        res.json({
          updated: true,
          targetSubmissionDeadline: nextTarget,
          stageDueAt: nextStageDue,
          scheduledNotifications,
        });
      } catch (err: any) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    },
  );

  // 3. Appointment Tracking
  router.get('/cases/:id/appointments', requireAuth, (req, res) => {
    try {
      const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
      const appointments = db
        .prepare(
          `
          SELECT a.*, u.full_name AS created_by_name
          FROM case_appointments a
          LEFT JOIN users u ON u.id = a.created_by_user_id
          WHERE a.application_id = ? AND a.organization_id = ?
          ORDER BY a.scheduled_at ASC
        `,
        )
        .all(String(appRow.id), String(appRow.organization_id));

      res.json({ appointments });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.post(
    '/cases/:id/appointments',
    requireAuth,
    requireRoles('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      try {
        const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
        const {
          appointmentType,
          centerName,
          centerAddress,
          scheduledAt,
          timezone,
          bookingReference,
          instructions,
        } = req.body as {
          appointmentType?: string;
          centerName?: string;
          centerAddress?: string;
          scheduledAt?: string;
          timezone?: string;
          bookingReference?: string;
          instructions?: string;
        };

        if (
          !appointmentType ||
          !APPOINTMENT_TYPES.includes(appointmentType as (typeof APPOINTMENT_TYPES)[number])
        ) {
          res.status(400).json({
            error: `Valid appointmentType required (${APPOINTMENT_TYPES.join(', ')})`,
          });
          return;
        }
        if (!centerName?.trim() || !scheduledAt?.trim()) {
          res.status(400).json({ error: 'centerName and scheduledAt are required' });
          return;
        }

        const now = new Date().toISOString();
        const apptId = newId('apt');
        db.prepare(`
          INSERT INTO case_appointments (
            id, application_id, organization_id, appointment_type, center_name,
            center_address, scheduled_at, timezone, booking_reference, status,
            instructions, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?)
        `).run(
          apptId,
          String(appRow.id),
          String(appRow.organization_id),
          appointmentType,
          centerName.trim(),
          centerAddress?.trim() || null,
          scheduledAt.trim(),
          timezone?.trim() || 'UTC',
          bookingReference?.trim() || null,
          instructions?.trim() || null,
          req.auth!.userId,
          now,
          now,
        );

        syncNextCaseAppointment(db, String(appRow.id), String(appRow.organization_id));

        writeAuditLog(db, {
          organizationId: String(appRow.organization_id),
          actorUserId: req.auth!.userId,
          action: 'APPOINTMENT_SCHEDULED',
          resourceType: 'CaseAppointment',
          resourceId: apptId,
          metadata: {
            applicationId: String(appRow.id),
            appointmentType,
            centerName: centerName.trim(),
            scheduledAt: scheduledAt.trim(),
            bookingReference: bookingReference?.trim() || null,
          },
          ipAddress: req.ip,
        });

        const notifications = scheduleCaseEventNotifications(db, {
          applicationId: String(appRow.id),
          organizationId: String(appRow.organization_id),
          templateKey: 'APPOINTMENT_SCHEDULED',
          variables: {
            appointmentType,
            appointmentStatus: 'SCHEDULED',
            appointmentAt: `${scheduledAt.trim()} (${timezone?.trim() || 'UTC'})`,
            centerName: centerName.trim(),
            bookingReference: bookingReference?.trim() || 'Pending receipt',
          },
          includeConsultant: true,
          actorUserId: req.auth!.userId,
        });

        const appointment = db
          .prepare('SELECT * FROM case_appointments WHERE id = ?')
          .get(apptId);
        res.status(201).json({ appointment, notifications });
      } catch (err: any) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    },
  );

  router.patch(
    '/cases/:id/appointments/:appointmentId',
    requireAuth,
    requireRoles('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      try {
        const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
        const existing = db
          .prepare(
            'SELECT * FROM case_appointments WHERE id = ? AND application_id = ? AND organization_id = ?',
          )
          .get(
            req.params.appointmentId,
            String(appRow.id),
            String(appRow.organization_id),
          ) as Record<string, unknown> | undefined;

        if (!existing) {
          res.status(404).json({ error: 'Appointment not found' });
          return;
        }

        const {
          status,
          scheduledAt,
          centerName,
          centerAddress,
          bookingReference,
          instructions,
        } = req.body as {
          status?: string;
          scheduledAt?: string;
          centerName?: string;
          centerAddress?: string | null;
          bookingReference?: string | null;
          instructions?: string | null;
        };

        const nextStatus = status
          ? status
          : String(existing.status);
        if (!APPOINTMENT_STATUSES.includes(nextStatus as (typeof APPOINTMENT_STATUSES)[number])) {
          res.status(400).json({ error: 'Invalid appointment status' });
          return;
        }

        const nextScheduledAt = scheduledAt?.trim() || String(existing.scheduled_at);
        const nextCenterName = centerName?.trim() || String(existing.center_name);
        const nextCenterAddr =
          centerAddress === undefined
            ? (existing.center_address as string | null)
            : centerAddress?.trim() || null;
        const nextBookingRef =
          bookingReference === undefined
            ? (existing.booking_reference as string | null)
            : bookingReference?.trim() || null;
        const nextInstructions =
          instructions === undefined
            ? (existing.instructions as string | null)
            : instructions?.trim() || null;

        db.prepare(`
          UPDATE case_appointments
          SET status = ?, scheduled_at = ?, center_name = ?, center_address = ?,
              booking_reference = ?, instructions = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `).run(
          nextStatus,
          nextScheduledAt,
          nextCenterName,
          nextCenterAddr,
          nextBookingRef,
          nextInstructions,
          new Date().toISOString(),
          String(existing.id),
          String(appRow.organization_id),
        );

        syncNextCaseAppointment(db, String(appRow.id), String(appRow.organization_id));

        writeAuditLog(db, {
          organizationId: String(appRow.organization_id),
          actorUserId: req.auth!.userId,
          action: 'APPOINTMENT_UPDATED',
          resourceType: 'CaseAppointment',
          resourceId: String(existing.id),
          metadata: {
            applicationId: String(appRow.id),
            status: nextStatus,
            scheduledAt: nextScheduledAt,
          },
          ipAddress: req.ip,
        });

        let notifications = [] as ReturnType<typeof scheduleCaseEventNotifications>;
        if (nextStatus === 'RESCHEDULED' || nextStatus === 'CANCELLED') {
          notifications = scheduleCaseEventNotifications(db, {
            applicationId: String(appRow.id),
            organizationId: String(appRow.organization_id),
            templateKey: 'APPOINTMENT_SCHEDULED',
            variables: {
              appointmentType: String(existing.appointment_type),
              appointmentStatus: nextStatus,
              appointmentAt: `${nextScheduledAt} (${String(existing.timezone)})`,
              centerName: nextCenterName,
              bookingReference: nextBookingRef || 'Pending receipt',
            },
            includeConsultant: true,
            actorUserId: req.auth!.userId,
          });
        }

        const appointment = db
          .prepare('SELECT * FROM case_appointments WHERE id = ?')
          .get(String(existing.id));
        res.json({ appointment, notifications });
      } catch (err: any) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    },
  );

  // 4. Unified Chronological Case Timeline
  router.get('/cases/:id/timeline', requireAuth, (req, res) => {
    try {
      const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
      const appId = String(appRow.id);
      const orgId = String(appRow.organization_id);
      const isApplicant = req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin;

      const timeline: Array<{
        id: string;
        category:
          | 'INTERNAL_WORKFLOW'
          | 'OFFICIAL_EXTERNAL'
          | 'APPOINTMENT'
          | 'TASK_DEADLINE'
          | 'SUBMISSION_HANDOFF'
          | 'NOTIFICATION';
        title: string;
        detail: string;
        actor: string | null;
        sourceAttribution: string | null;
        timestamp: string;
        metadata?: Record<string, unknown>;
      }> = [];

      const historyRows = db
        .prepare(
          `
          SELECT h.*, u.full_name AS actor_name
          FROM application_status_history h
          LEFT JOIN users u ON u.id = h.changed_by_user_id
          WHERE h.application_id = ? AND h.organization_id = ?
        `,
        )
        .all(appId, orgId) as Array<Record<string, unknown>>;

      for (const h of historyRows) {
        timeline.push({
          id: `tl_hist_${String(h.id)}`,
          category: 'INTERNAL_WORKFLOW',
          title: h.from_status
            ? `Internal stage: ${String(h.from_status)} -> ${String(h.to_status)}`
            : `Internal stage initialized: ${String(h.to_status)}`,
          detail: h.reason ? String(h.reason) : 'Workflow transition recorded.',
          actor: h.actor_name ? String(h.actor_name) : null,
          sourceAttribution: 'INTERNAL_AGENCY_WORKFLOW',
          timestamp: String(h.created_at),
        });
      }

      const statusEventRows = db
        .prepare(
          `
          SELECT e.*, u.full_name AS verified_by_name
          FROM status_tracking_events e
          LEFT JOIN users u ON u.id = e.verified_by_user_id
          WHERE e.application_id = ? AND e.organization_id = ?
        `,
        )
        .all(appId, orgId) as Array<Record<string, unknown>>;

      for (const ev of statusEventRows) {
        timeline.push({
          id: `tl_ste_${String(ev.id)}`,
          category: 'OFFICIAL_EXTERNAL',
          title: `External status: ${String(ev.status_text)}`,
          detail: [
            ev.tracking_reference ? `Ref: ${String(ev.tracking_reference)}` : null,
            ev.raw_evidence_note ? String(ev.raw_evidence_note) : null,
          ]
            .filter(Boolean)
            .join(' — ') || 'Source-attributed external status recorded.',
          actor: ev.verified_by_name ? String(ev.verified_by_name) : 'Authorized Adapter',
          sourceAttribution: String(ev.source_type),
          timestamp: String(ev.verified_at),
        });
      }

      const apptRows = db
        .prepare(
          `
          SELECT a.*, u.full_name AS created_by_name
          FROM case_appointments a
          LEFT JOIN users u ON u.id = a.created_by_user_id
          WHERE a.application_id = ? AND a.organization_id = ?
        `,
        )
        .all(appId, orgId) as Array<Record<string, unknown>>;

      for (const a of apptRows) {
        timeline.push({
          id: `tl_apt_${String(a.id)}`,
          category: 'APPOINTMENT',
          title: `${String(a.appointment_type)} (${String(a.status)})`,
          detail: `${String(a.center_name)} — Scheduled for ${String(a.scheduled_at)} (${String(a.timezone)})${
            a.booking_reference ? ` | Ref: ${String(a.booking_reference)}` : ''
          }`,
          actor: a.created_by_name ? String(a.created_by_name) : null,
          sourceAttribution: 'APPOINTMENT_TRACKER',
          timestamp: String(a.updated_at),
        });
      }

      const handoffRows = db
        .prepare(
          `
          SELECT s.*, u.full_name AS submitted_by_name
          FROM submission_handoffs s
          LEFT JOIN users u ON u.id = s.submitted_by_user_id
          WHERE s.application_id = ? AND s.organization_id = ?
        `,
        )
        .all(appId, orgId) as Array<Record<string, unknown>>;

      for (const s of handoffRows) {
        timeline.push({
          id: `tl_sub_${String(s.id)}`,
          category: 'SUBMISSION_HANDOFF',
          title: `Submission handoff: ${String(s.submission_mode)} (${String(s.status)})`,
          detail: s.external_confirmation_ref
            ? `Confirmation Ref: ${String(s.external_confirmation_ref)}`
            : 'Prepared guided manual filing package.',
          actor: s.submitted_by_name ? String(s.submitted_by_name) : null,
          sourceAttribution: String(s.adapter_id),
          timestamp: String(s.created_at),
        });
      }

      const notifRows = db
        .prepare(
          `
          SELECT * FROM notification_jobs
          WHERE application_id = ? AND organization_id = ?
        `,
        )
        .all(appId, orgId) as Array<Record<string, unknown>>;

      for (const n of notifRows) {
        if (isApplicant && String(n.recipient_user_id || '') !== req.auth!.userId) {
          continue;
        }
        timeline.push({
          id: `tl_ntf_${String(n.id)}`,
          category: 'NOTIFICATION',
          title: `${String(n.channel)} notification (${String(n.status)}): ${String(n.template_key)}`,
          detail: `${String(n.recipient_contact)} — Attempts: ${String(n.attempts)}/${String(n.max_attempts)}`,
          actor: 'Meridian Notification Worker',
          sourceAttribution: String(n.channel),
          timestamp: String(n.dispatched_at || n.updated_at),
        });
      }

      const taskRows = db
        .prepare(
          `
          SELECT t.*, u_assign.full_name AS assigned_to_name, u_create.full_name AS created_by_name
          FROM case_tasks t
          LEFT JOIN users u_assign ON u_assign.id = t.assigned_to_user_id
          LEFT JOIN users u_create ON u_create.id = t.created_by_user_id
          WHERE t.application_id = ? AND t.organization_id = ?
        `,
        )
        .all(appId, orgId) as Array<Record<string, unknown>>;

      for (const t of taskRows) {
        timeline.push({
          id: `tl_tsk_${String(t.id)}`,
          category: 'TASK_DEADLINE',
          title: `Task (${String(t.status)}): ${String(t.title)}`,
          detail: [
            t.due_at ? `Due: ${String(t.due_at)}` : 'No due date',
            t.assigned_to_name ? `Assignee: ${String(t.assigned_to_name)}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          actor: t.created_by_name ? String(t.created_by_name) : null,
          sourceAttribution: 'CASE_TASK',
          timestamp: String(t.updated_at || t.created_at),
        });
      }

      const milestoneAudits = db
        .prepare(
          `
          SELECT a.*, u.full_name AS actor_name
          FROM audit_logs a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.organization_id = ?
            AND a.resource_type = 'VisaApplication'
            AND a.resource_id = ?
            AND a.action IN ('CASE_ASSIGNED', 'CASE_UNASSIGNED', 'CASE_DEADLINES_UPDATED')
        `,
        )
        .all(orgId, appId) as Array<Record<string, unknown>>;

      for (const a of milestoneAudits) {
        const meta = a.metadata_json ? (JSON.parse(String(a.metadata_json)) as Record<string, unknown>) : {};
        if (a.action === 'CASE_DEADLINES_UPDATED') {
          timeline.push({
            id: `tl_aud_${String(a.id)}`,
            category: 'TASK_DEADLINE',
            title: 'Case deadlines updated',
            detail: [
              meta.targetSubmissionDeadline
                ? `Target submission: ${String(meta.targetSubmissionDeadline)}`
                : null,
              meta.stageDueAt ? `Stage SLA due: ${String(meta.stageDueAt)}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Deadlines cleared',
            actor: a.actor_name ? String(a.actor_name) : null,
            sourceAttribution: 'DEADLINE_TRACKER',
            timestamp: String(a.created_at),
          });
        } else {
          timeline.push({
            id: `tl_aud_${String(a.id)}`,
            category: 'INTERNAL_WORKFLOW',
            title:
              a.action === 'CASE_ASSIGNED'
                ? 'Consultant assigned to case'
                : 'Consultant unassigned from case',
            detail: meta.assignedConsultantId
              ? `Assigned officer ID: ${String(meta.assignedConsultantId)}`
              : 'Returned to unassigned admin queue',
            actor: a.actor_name ? String(a.actor_name) : null,
            sourceAttribution: 'INTERNAL_AGENCY_WORKFLOW',
            timestamp: String(a.created_at),
          });
        }
      }

      timeline.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      res.json({ timeline });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // 5. Status Tracking Overview, Manual Events, and Authorized Official API Sync
  router.get('/cases/:id/status-tracking', requireAuth, (req, res) => {
    try {
      const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
      const overview = listStatusTrackingOverview(
        db,
        String(appRow.id),
        String(appRow.organization_id),
      );
      res.json(overview);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.post(
    '/cases/:id/status-events',
    requireAuth,
    requireRoles('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      try {
        const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
        const {
          statusText,
          sourceType,
          trackingReference,
          rawEvidenceNote,
          verifiedAt,
        } = req.body as {
          statusText?: string;
          sourceType?: GovernmentStatusSource;
          trackingReference?: string;
          rawEvidenceNote?: string;
          verifiedAt?: string;
        };

        const event = recordManualVerifiedStatusEvent(db, {
          applicationId: String(appRow.id),
          organizationId: String(appRow.organization_id),
          actorUserId: req.auth!.userId,
          statusText: statusText || '',
          sourceType: sourceType as GovernmentStatusSource,
          trackingReference,
          rawEvidenceNote,
          verifiedAt,
          ipAddress: req.ip,
        });

        const notifications = scheduleCaseEventNotifications(db, {
          applicationId: String(appRow.id),
          organizationId: String(appRow.organization_id),
          templateKey: 'OFFICIAL_STATUS_VERIFIED',
          variables: {
            statusText: event.statusText,
            sourceType: event.sourceType,
            verifiedAt: event.verifiedAt,
            trackingReference: event.trackingReference || 'None',
          },
          includeConsultant: false,
          actorUserId: req.auth!.userId,
        });

        res.status(201).json({ event, notifications });
      } catch (err: any) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    },
  );

  router.post(
    '/cases/:id/status-sync',
    requireAuth,
    requireRoles('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    async (req, res) => {
      try {
        const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
        const result = await syncStatusFromAuthorizedApi(db, {
          applicationId: String(appRow.id),
          organizationId: String(appRow.organization_id),
          actorUserId: req.auth!.userId,
          ipAddress: req.ip,
        });

        if (result.status === 'UNAVAILABLE') {
          res.status(409).json(result);
          return;
        }
        if (result.status === 'ERROR') {
          res.status(502).json(result);
          return;
        }

        const notifications = scheduleCaseEventNotifications(db, {
          applicationId: String(appRow.id),
          organizationId: String(appRow.organization_id),
          templateKey: 'OFFICIAL_STATUS_VERIFIED',
          variables: {
            statusText: result.statusText,
            sourceType: 'OFFICIAL_API',
            verifiedAt: result.verifiedAt,
            trackingReference: result.trackingReference || 'None',
          },
          includeConsultant: true,
          actorUserId: req.auth!.userId,
        });

        res.json({ ...result, notifications });
      } catch (err: any) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    },
  );

  // 6. Email/SMS Notification Templates, Queue & Retry Worker
  router.get('/notifications/templates', requireAuth, (req, res) => {
    const templates = listNotificationTemplates(db, req.auth!.organizationId);
    res.json({ templates });
  });

  router.patch(
    '/notifications/templates/:templateKey/:channel',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const templateKey = req.params.templateKey as NotificationTemplateKey;
      const channel = req.params.channel as NotificationChannel;
      const { subjectTemplate, bodyTemplate, isActive } = req.body as {
        subjectTemplate?: string | null;
        bodyTemplate?: string;
        isActive?: boolean;
      };

      try {
        const template = upsertOrgNotificationTemplate(db, {
          organizationId: req.auth!.organizationId,
          templateKey,
          channel,
          subjectTemplate,
          bodyTemplate: bodyTemplate || '',
          isActive,
        });

        writeAuditLog(db, {
          organizationId: req.auth!.organizationId,
          actorUserId: req.auth!.userId,
          action: 'NOTIFICATION_TEMPLATE_UPDATED',
          resourceType: 'NotificationTemplate',
          resourceId: `${templateKey}:${channel}`,
          metadata: { isActive: template.isActive },
          ipAddress: req.ip,
        });

        res.json({ template });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    },
  );

  router.get('/notifications', requireAuth, (req, res) => {
    const appId =
      typeof req.query.applicationId === 'string' ? req.query.applicationId : null;
    let jobs = listCaseNotifications(db, req.auth!.organizationId, appId);
    if (req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin) {
      jobs = jobs.filter((j) => j.recipientUserId === req.auth!.userId);
    }
    res.json({ jobs });
  });

  router.get('/cases/:id/notifications', requireAuth, (req, res) => {
    try {
      const appRow = loadAuthorizedCase(db, req.params.id, req.auth!);
      let jobs = listCaseNotifications(
        db,
        String(appRow.organization_id),
        String(appRow.id),
      );
      if (req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin) {
        jobs = jobs.filter((j) => j.recipientUserId === req.auth!.userId);
      }
      res.json({ jobs });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.post(
    '/notifications/run-worker',
    requireAuth,
    requireRoles('AGENCY_ADMIN', 'CONSULTANT', 'VERIFICATION_OFFICER'),
    async (req, res) => {
      const { forceDue, failNextDelivery, jobId } = (req.body || {}) as {
        forceDue?: boolean;
        failNextDelivery?: boolean;
        jobId?: string;
      };
      const result = await processNotificationWorker(db, {
        organizationId: req.auth!.organizationId,
        forceDue: Boolean(forceDue),
        failNextDelivery: Boolean(failNextDelivery),
        jobId,
      });
      res.json(result);
    },
  );

  router.post(
    '/notifications/:jobId/retry',
    requireAuth,
    requireRoles('AGENCY_ADMIN', 'CONSULTANT', 'VERIFICATION_OFFICER'),
    async (req, res) => {
      const jobRow = db
        .prepare('SELECT * FROM notification_jobs WHERE id = ?')
        .get(req.params.jobId) as Record<string, unknown> | undefined;

      if (!jobRow) {
        res.status(404).json({ error: 'Notification job not found' });
        return;
      }
      if (
        !req.auth!.isPlatformAdmin &&
        String(jobRow.organization_id) !== req.auth!.organizationId
      ) {
        res.status(403).json({ error: 'Forbidden: cross-tenant notification retry denied' });
        return;
      }

      const { resetAttempts, failNextDelivery } = (req.body || {}) as {
        resetAttempts?: boolean;
        failNextDelivery?: boolean;
      };

      if (String(jobRow.status) === 'FAILED_PERMANENT' && !resetAttempts) {
        res.status(409).json({
          error:
            'Notification has reached FAILED_PERMANENT after exhausting retry budget. Pass resetAttempts=true to re-queue.',
        });
        return;
      }

      const now = new Date().toISOString();
      if (resetAttempts) {
        db.prepare(`
          UPDATE notification_jobs
          SET status = 'SCHEDULED', attempts = 0, scheduled_for = ?, last_error = NULL, updated_at = ?
          WHERE id = ?
        `).run(now, now, String(jobRow.id));
      } else {
        db.prepare(`
          UPDATE notification_jobs
          SET scheduled_for = ?, updated_at = ?
          WHERE id = ?
        `).run(now, now, String(jobRow.id));
      }

      const result = await processNotificationWorker(db, {
        organizationId: String(jobRow.organization_id),
        jobId: String(jobRow.id),
        forceDue: true,
        failNextDelivery: Boolean(failNextDelivery),
      });

      res.json({ retried: true, result });
    },
  );

  return router;
}
