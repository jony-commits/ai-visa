import { AppDatabase, newId, writeAuditLog } from '../db.ts';

export const QUEUE_NOTIFICATIONS = 'meridian-notifications';

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TEMPLATE_KEYS = [
  'CASE_STAGE_CHANGED',
  'CONSULTANT_ASSIGNED',
  'APPOINTMENT_SCHEDULED',
  'DEADLINE_REMINDER',
  'OFFICIAL_STATUS_VERIFIED',
] as const;

export type NotificationTemplateKey = (typeof NOTIFICATION_TEMPLATE_KEYS)[number];

export interface NotificationTemplateRecord {
  id: string;
  organizationId: string;
  templateKey: NotificationTemplateKey;
  channel: NotificationChannel;
  eventTrigger: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  isActive: boolean;
  isCustomOverride: boolean;
  updatedAt: string;
}

export interface NotificationJobRecord {
  id: string;
  organizationId: string;
  applicationId: string | null;
  recipientUserId: string | null;
  recipientContact: string;
  channel: NotificationChannel;
  templateKey: string;
  subject: string | null;
  renderedBody: string;
  scheduledFor: string;
  status: 'SCHEDULED' | 'RETRY_WAIT' | 'DELIVERED' | 'FAILED_PERMANENT' | 'SKIPPED_NO_CONSENT';
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  bullmqJobId: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_TEMPLATES: Array<{
  templateKey: NotificationTemplateKey;
  channel: NotificationChannel;
  eventTrigger: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
}> = [
  {
    templateKey: 'CASE_STAGE_CHANGED',
    channel: 'EMAIL',
    eventTrigger: 'Internal workflow stage transition',
    subjectTemplate: '[Meridian Visa] Case {{referenceNumber}} moved to {{stageLabel}}',
    bodyTemplate:
      'Hello {{recipientName}}, internal case {{referenceNumber}} ({{destinationCountry}}) is now in stage "{{stageLabel}}". Current SLA due: {{stageDueAt}}. Official government status remains tracked separately as {{governmentStatus}}.',
  },
  {
    templateKey: 'CASE_STAGE_CHANGED',
    channel: 'SMS',
    eventTrigger: 'Internal workflow stage transition',
    subjectTemplate: null,
    bodyTemplate:
      'Meridian Visa: Case {{referenceNumber}} updated to internal stage "{{stageLabel}}". Log in to review next steps.',
  },
  {
    templateKey: 'CONSULTANT_ASSIGNED',
    channel: 'EMAIL',
    eventTrigger: 'Consultant assigned or reassigned to case',
    subjectTemplate: '[Meridian Visa] Case {{referenceNumber}} assigned to {{consultantName}}',
    bodyTemplate:
      'Hello {{recipientName}}, {{consultantName}} has been assigned as the case officer for {{referenceNumber}} ({{destinationCountry}} {{visaCategory}}). Target submission deadline: {{targetDeadline}}.',
  },
  {
    templateKey: 'APPOINTMENT_SCHEDULED',
    channel: 'EMAIL',
    eventTrigger: 'Biometrics, consulate interview, or collection scheduled/updated',
    subjectTemplate: '[Meridian Visa] {{appointmentType}} scheduled for {{referenceNumber}}',
    bodyTemplate:
      'Hello {{recipientName}}, an appointment ({{appointmentType}}) for case {{referenceNumber}} is {{appointmentStatus}} for {{appointmentAt}} at {{centerName}}. Reference: {{bookingReference}}.',
  },
  {
    templateKey: 'APPOINTMENT_SCHEDULED',
    channel: 'SMS',
    eventTrigger: 'Biometrics, consulate interview, or collection scheduled/updated',
    subjectTemplate: null,
    bodyTemplate:
      'Meridian Visa: {{appointmentType}} for {{referenceNumber}} is {{appointmentStatus}} on {{appointmentAt}} at {{centerName}}.',
  },
  {
    templateKey: 'DEADLINE_REMINDER',
    channel: 'EMAIL',
    eventTrigger: 'Target submission deadline or SLA reminder',
    subjectTemplate: '[Meridian Visa] Deadline reminder for case {{referenceNumber}}',
    bodyTemplate:
      'Hello {{recipientName}}, reminder that case {{referenceNumber}} has a target submission deadline of {{targetDeadline}} (stage SLA due {{stageDueAt}}). Please review open checklist items.',
  },
  {
    templateKey: 'DEADLINE_REMINDER',
    channel: 'SMS',
    eventTrigger: 'Target submission deadline or SLA reminder',
    subjectTemplate: null,
    bodyTemplate:
      'Meridian Visa reminder: Case {{referenceNumber}} target deadline is {{targetDeadline}}.',
  },
  {
    templateKey: 'OFFICIAL_STATUS_VERIFIED',
    channel: 'EMAIL',
    eventTrigger: 'Verified official/external government status recorded',
    subjectTemplate: '[Meridian Visa] Verified external status update for {{referenceNumber}}',
    bodyTemplate:
      'Hello {{recipientName}}, a verified external status update was recorded for case {{referenceNumber}}: "{{statusText}}" (Source: {{sourceType}}, Verified At: {{verifiedAt}}, Ref: {{trackingReference}}).',
  },
  {
    templateKey: 'OFFICIAL_STATUS_VERIFIED',
    channel: 'SMS',
    eventTrigger: 'Verified official/external government status recorded',
    subjectTemplate: null,
    bodyTemplate:
      'Meridian Visa: Verified external status for {{referenceNumber}}: "{{statusText}}" ({{sourceType}}).',
  },
];

export function seedNotificationTemplates(db: AppDatabase): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO notification_templates (
      id, organization_id, template_key, channel, event_trigger,
      subject_template, body_template, is_active, updated_at
    ) VALUES (?, '*', ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(organization_id, template_key, channel) DO UPDATE SET
      event_trigger = excluded.event_trigger,
      subject_template = excluded.subject_template,
      body_template = excluded.body_template,
      updated_at = excluded.updated_at
  `);

  for (const tpl of DEFAULT_TEMPLATES) {
    stmt.run(
      `tpl_sys_${tpl.templateKey.toLowerCase()}_${tpl.channel.toLowerCase()}`,
      tpl.templateKey,
      tpl.channel,
      tpl.eventTrigger,
      tpl.subjectTemplate,
      tpl.bodyTemplate,
      now,
    );
  }
}

export function listNotificationTemplates(
  db: AppDatabase,
  organizationId: string,
): NotificationTemplateRecord[] {
  seedNotificationTemplates(db);
  const rows = db
    .prepare(
      `
      SELECT * FROM notification_templates
      WHERE organization_id IN ('*', ?)
      ORDER BY template_key ASC, channel ASC
    `,
    )
    .all(organizationId) as Array<Record<string, unknown>>;

  const merged = new Map<string, NotificationTemplateRecord>();
  for (const r of rows) {
    const key = `${String(r.template_key)}:${String(r.channel)}`;
    const isCustom = String(r.organization_id) === organizationId;
    const existing = merged.get(key);
    if (!existing || isCustom) {
      merged.set(key, {
        id: String(r.id),
        organizationId: String(r.organization_id),
        templateKey: String(r.template_key) as NotificationTemplateKey,
        channel: String(r.channel) as NotificationChannel,
        eventTrigger: String(r.event_trigger),
        subjectTemplate: r.subject_template ? String(r.subject_template) : null,
        bodyTemplate: String(r.body_template),
        isActive: Boolean(r.is_active),
        isCustomOverride: isCustom,
        updatedAt: String(r.updated_at),
      });
    }
  }

  return Array.from(merged.values());
}

export function upsertOrgNotificationTemplate(
  db: AppDatabase,
  params: {
    organizationId: string;
    templateKey: NotificationTemplateKey;
    channel: NotificationChannel;
    subjectTemplate?: string | null;
    bodyTemplate: string;
    isActive?: boolean;
  },
): NotificationTemplateRecord {
  seedNotificationTemplates(db);

  if (!NOTIFICATION_TEMPLATE_KEYS.includes(params.templateKey)) {
    throw new Error(`Unsupported template key "${params.templateKey}"`);
  }
  if (!NOTIFICATION_CHANNELS.includes(params.channel)) {
    throw new Error(`Unsupported channel "${params.channel}"`);
  }
  if (!params.bodyTemplate?.trim()) {
    throw new Error('bodyTemplate cannot be empty');
  }

  const sysRow = db
    .prepare(
      `SELECT event_trigger FROM notification_templates WHERE organization_id = '*' AND template_key = ? AND channel = ?`,
    )
    .get(params.templateKey, params.channel) as { event_trigger: string } | undefined;

  const now = new Date().toISOString();
  const isActiveVal = params.isActive === undefined ? 1 : params.isActive ? 1 : 0;
  const subjectVal =
    params.channel === 'EMAIL' ? (params.subjectTemplate?.trim() || null) : null;

  db.prepare(`
    INSERT INTO notification_templates (
      id, organization_id, template_key, channel, event_trigger,
      subject_template, body_template, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, template_key, channel) DO UPDATE SET
      subject_template = excluded.subject_template,
      body_template = excluded.body_template,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `).run(
    newId('tpl'),
    params.organizationId,
    params.templateKey,
    params.channel,
    sysRow?.event_trigger || params.templateKey,
    subjectVal,
    params.bodyTemplate.trim(),
    isActiveVal,
    now,
  );

  const all = listNotificationTemplates(db, params.organizationId);
  return all.find(
    (t) => t.templateKey === params.templateKey && t.channel === params.channel,
  )!;
}

export function renderNotificationTemplate(
  template: string,
  variables: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = variables[key];
    return val !== undefined && val !== null && String(val).trim() !== ''
      ? String(val)
      : 'Not specified';
  });
}

export function hasApplicantCommunicationConsent(
  db: AppDatabase,
  userId: string,
  organizationId: string,
): boolean {
  const row = db
    .prepare(
      `
      SELECT granted FROM applicant_consents
      WHERE user_id = ? AND organization_id = ? AND consent_type = 'COMMUNICATIONS'
    `,
    )
    .get(userId, organizationId) as { granted: number } | undefined;

  return Boolean(row?.granted);
}

export function scheduleNotificationFromTemplate(
  db: AppDatabase,
  params: {
    organizationId: string;
    applicationId?: string | null;
    recipientUserId?: string | null;
    recipientRole?: 'APPLICANT' | 'STAFF';
    recipientContact: string;
    channel: NotificationChannel;
    templateKey: NotificationTemplateKey;
    variables: Record<string, string | null | undefined>;
    scheduledFor?: string;
    maxAttempts?: number;
  },
): NotificationJobRecord | null {
  const templates = listNotificationTemplates(db, params.organizationId);
  const tpl = templates.find(
    (t) => t.templateKey === params.templateKey && t.channel === params.channel,
  );
  if (!tpl || !tpl.isActive) {
    return null;
  }

  const now = new Date().toISOString();
  const scheduledFor = params.scheduledFor || now;
  const renderedSubject = tpl.subjectTemplate
    ? renderNotificationTemplate(tpl.subjectTemplate, params.variables)
    : null;
  const renderedBody = renderNotificationTemplate(tpl.bodyTemplate, params.variables);

  let initialStatus: NotificationJobRecord['status'] = 'SCHEDULED';
  let lastError: string | null = null;

  if (
    params.recipientRole === 'APPLICANT' &&
    params.recipientUserId &&
    !hasApplicantCommunicationConsent(db, params.recipientUserId, params.organizationId)
  ) {
    initialStatus = 'SKIPPED_NO_CONSENT';
    lastError = 'Blocked: Applicant COMMUNICATIONS consent is not granted.';
  }

  const jobId = newId('ntf');
  const bullmqJobId = `${QUEUE_NOTIFICATIONS}:notification.dispatch:${jobId}`;
  const maxAttempts = params.maxAttempts ?? 3;

  db.prepare(`
    INSERT INTO notification_jobs (
      id, organization_id, application_id, recipient_user_id, recipient_contact,
      channel, template_key, subject, rendered_body, scheduled_for,
      status, attempts, max_attempts, last_error, bullmq_job_id,
      dispatched_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?)
  `).run(
    jobId,
    params.organizationId,
    params.applicationId || null,
    params.recipientUserId || null,
    params.recipientContact,
    params.channel,
    params.templateKey,
    renderedSubject,
    renderedBody,
    scheduledFor,
    initialStatus,
    maxAttempts,
    lastError,
    bullmqJobId,
    now,
    now,
  );

  return mapNotificationJobRow(
    db.prepare('SELECT * FROM notification_jobs WHERE id = ?').get(jobId) as Record<
      string,
      unknown
    >,
  );
}

function mapNotificationJobRow(r: Record<string, unknown>): NotificationJobRecord {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    applicationId: r.application_id ? String(r.application_id) : null,
    recipientUserId: r.recipient_user_id ? String(r.recipient_user_id) : null,
    recipientContact: String(r.recipient_contact),
    channel: String(r.channel) as NotificationChannel,
    templateKey: String(r.template_key),
    subject: r.subject ? String(r.subject) : null,
    renderedBody: String(r.rendered_body),
    scheduledFor: String(r.scheduled_for),
    status: String(r.status) as NotificationJobRecord['status'],
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    lastError: r.last_error ? String(r.last_error) : null,
    bullmqJobId: r.bullmq_job_id ? String(r.bullmq_job_id) : null,
    dispatchedAt: r.dispatched_at ? String(r.dispatched_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function processNotificationWorker(
  db: AppDatabase,
  options: {
    organizationId?: string;
    nowIso?: string;
    forceDue?: boolean;
    failNextDelivery?: boolean;
    jobId?: string;
  } = {},
): Promise<{
  processed: number;
  delivered: number;
  retried: number;
  failedPermanent: number;
  jobs: NotificationJobRecord[];
}> {
  const nowIso = options.nowIso || new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();

  const conditions = ["status IN ('SCHEDULED', 'RETRY_WAIT')"];
  const params: (string | number)[] = [];

  if (!options.forceDue) {
    conditions.push('scheduled_for <= ?');
    params.push(nowIso);
  }
  if (options.organizationId) {
    conditions.push('organization_id = ?');
    params.push(options.organizationId);
  }
  if (options.jobId) {
    conditions.push('id = ?');
    params.push(options.jobId);
  }

  const dueRows = db
    .prepare(
      `
      SELECT * FROM notification_jobs
      WHERE ${conditions.join(' AND ')}
      ORDER BY scheduled_for ASC
      LIMIT 50
    `,
    )
    .all(...params) as Array<Record<string, unknown>>;

  let delivered = 0;
  let retried = 0;
  let failedPermanent = 0;
  const updatedJobs: NotificationJobRecord[] = [];
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL?.trim();

  for (const row of dueRows) {
    const job = mapNotificationJobRow(row);
    const nextAttempt = job.attempts + 1;
    let transportError: string | null = null;

    if (options.failNextDelivery || job.recipientContact.startsWith('fail://')) {
      transportError = 'Simulated notification gateway transient timeout (503).';
    } else if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id,
            channel: job.channel,
            to: job.recipientContact,
            subject: job.subject,
            body: job.renderedBody,
          }),
        });
        if (!res.ok) {
          transportError = `Notification webhook responded with HTTP ${res.status}.`;
        }
      } catch (err: any) {
        transportError = err?.message || 'Notification webhook network failure.';
      }
    }

    if (!transportError) {
      db.prepare(`
        UPDATE notification_jobs
        SET status = 'DELIVERED', attempts = ?, last_error = NULL,
            dispatched_at = ?, updated_at = ?
        WHERE id = ?
      `).run(nextAttempt, nowIso, nowIso, job.id);

      if (job.applicationId) {
        db.prepare(`
          INSERT INTO processing_jobs (
            id, organization_id, application_id, document_id, queue_name,
            job_name, bullmq_job_id, status, attempts, payload_json, result_json,
            created_at, completed_at
          ) VALUES (?, ?, ?, NULL, ?, 'notification.dispatch', ?, 'COMPLETED', ?, ?, ?, ?, ?)
        `).run(
          newId('job'),
          job.organizationId,
          job.applicationId,
          QUEUE_NOTIFICATIONS,
          job.bullmqJobId,
          nextAttempt,
          JSON.stringify({ notificationJobId: job.id, channel: job.channel, templateKey: job.templateKey }),
          JSON.stringify({ transport: webhookUrl ? 'WEBHOOK' : 'SANDBOX_OUTBOX', deliveredAt: nowIso }),
          nowIso,
          nowIso,
        );
      }
      delivered++;
    } else {
      const exhausted = nextAttempt >= job.maxAttempts;
      const nextStatus = exhausted ? 'FAILED_PERMANENT' : 'RETRY_WAIT';
      const backoffMs = nextAttempt * 60_000;
      const nextScheduledFor = exhausted
        ? job.scheduledFor
        : new Date(nowMs + backoffMs).toISOString();

      db.prepare(`
        UPDATE notification_jobs
        SET status = ?, attempts = ?, scheduled_for = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(nextStatus, nextAttempt, nextScheduledFor, transportError, nowIso, job.id);

      if (job.applicationId) {
        db.prepare(`
          INSERT INTO processing_jobs (
            id, organization_id, application_id, document_id, queue_name,
            job_name, bullmq_job_id, status, attempts, payload_json, error_message,
            created_at, completed_at
          ) VALUES (?, ?, ?, NULL, ?, 'notification.dispatch', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId('job'),
          job.organizationId,
          job.applicationId,
          QUEUE_NOTIFICATIONS,
          job.bullmqJobId,
          exhausted ? 'FAILED' : 'RETRY_WAIT',
          nextAttempt,
          JSON.stringify({ notificationJobId: job.id, channel: job.channel, templateKey: job.templateKey }),
          transportError,
          nowIso,
          exhausted ? nowIso : null,
        );
      }

      if (exhausted) {
        failedPermanent++;
      } else {
        retried++;
      }
    }

    const refreshed = db
      .prepare('SELECT * FROM notification_jobs WHERE id = ?')
      .get(job.id) as Record<string, unknown>;
    updatedJobs.push(mapNotificationJobRow(refreshed));
  }

  return {
    processed: dueRows.length,
    delivered,
    retried,
    failedPermanent,
    jobs: updatedJobs,
  };
}

export function scheduleCaseEventNotifications(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    templateKey: NotificationTemplateKey;
    variables: Record<string, string | null | undefined>;
    includeConsultant?: boolean;
    scheduledFor?: string;
    actorUserId?: string;
  },
): NotificationJobRecord[] {
  const appInfo = db
    .prepare(
      `
      SELECT a.id, a.reference_number, a.destination_country, a.visa_category,
             a.government_status, a.target_submission_deadline, a.stage_due_at,
             a.applicant_user_id, a.assigned_consultant_id,
             u_app.full_name AS applicant_name, u_app.email AS applicant_email,
             p.phone AS applicant_phone,
             u_con.full_name AS consultant_name, u_con.email AS consultant_email
      FROM visa_applications a
      JOIN users u_app ON u_app.id = a.applicant_user_id
      LEFT JOIN applicant_profiles p ON p.user_id = a.applicant_user_id AND p.organization_id = a.organization_id
      LEFT JOIN users u_con ON u_con.id = a.assigned_consultant_id
      WHERE a.id = ? AND a.organization_id = ?
    `,
    )
    .get(params.applicationId, params.organizationId) as Record<string, unknown> | undefined;

  if (!appInfo) return [];

  const created: NotificationJobRecord[] = [];
  const commonVars: Record<string, string | null | undefined> = {
    referenceNumber: String(appInfo.reference_number),
    destinationCountry: String(appInfo.destination_country),
    visaCategory: String(appInfo.visa_category),
    governmentStatus: String(appInfo.government_status),
    targetDeadline: appInfo.target_submission_deadline
      ? String(appInfo.target_submission_deadline)
      : null,
    stageDueAt: appInfo.stage_due_at ? String(appInfo.stage_due_at) : null,
    consultantName: appInfo.consultant_name ? String(appInfo.consultant_name) : 'Unassigned',
    ...params.variables,
  };

  if (params.templateKey !== 'CONSULTANT_ASSIGNED') {
    const emailJob = scheduleNotificationFromTemplate(db, {
      organizationId: params.organizationId,
      applicationId: params.applicationId,
      recipientUserId: String(appInfo.applicant_user_id),
      recipientRole: 'APPLICANT',
      recipientContact: String(appInfo.applicant_email),
      channel: 'EMAIL',
      templateKey: params.templateKey,
      variables: {
        ...commonVars,
        recipientName: String(appInfo.applicant_name),
      },
      scheduledFor: params.scheduledFor,
    });
    if (emailJob) created.push(emailJob);

    if (appInfo.applicant_phone && String(appInfo.applicant_phone).trim()) {
      const smsJob = scheduleNotificationFromTemplate(db, {
        organizationId: params.organizationId,
        applicationId: params.applicationId,
        recipientUserId: String(appInfo.applicant_user_id),
        recipientRole: 'APPLICANT',
        recipientContact: String(appInfo.applicant_phone),
        channel: 'SMS',
        templateKey: params.templateKey,
        variables: {
          ...commonVars,
          recipientName: String(appInfo.applicant_name),
        },
        scheduledFor: params.scheduledFor,
      });
      if (smsJob) created.push(smsJob);
    }
  }

  if (
    (params.includeConsultant || params.templateKey === 'CONSULTANT_ASSIGNED') &&
    appInfo.assigned_consultant_id &&
    appInfo.consultant_email
  ) {
    const staffJob = scheduleNotificationFromTemplate(db, {
      organizationId: params.organizationId,
      applicationId: params.applicationId,
      recipientUserId: String(appInfo.assigned_consultant_id),
      recipientRole: 'STAFF',
      recipientContact: String(appInfo.consultant_email),
      channel: 'EMAIL',
      templateKey: params.templateKey,
      variables: {
        ...commonVars,
        recipientName: String(appInfo.consultant_name || 'Consultant'),
      },
      scheduledFor: params.scheduledFor,
    });
    if (staffJob) created.push(staffJob);
  }

  if (created.length > 0 && params.actorUserId) {
    writeAuditLog(db, {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      action: 'NOTIFICATIONS_SCHEDULED',
      resourceType: 'VisaApplication',
      resourceId: params.applicationId,
      metadata: {
        templateKey: params.templateKey,
        jobCount: created.length,
        statuses: created.map((j) => `${j.channel}:${j.status}`),
      },
    });
  }

  return created;
}

export function listCaseNotifications(
  db: AppDatabase,
  organizationId: string,
  applicationId?: string | null,
): NotificationJobRecord[] {
  const rows = applicationId
    ? (db
        .prepare(
          `
          SELECT * FROM notification_jobs
          WHERE organization_id = ? AND application_id = ?
          ORDER BY created_at DESC
          LIMIT 100
        `,
        )
        .all(organizationId, applicationId) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `
          SELECT * FROM notification_jobs
          WHERE organization_id = ?
          ORDER BY created_at DESC
          LIMIT 100
        `,
        )
        .all(organizationId) as Array<Record<string, unknown>>);

  return rows.map(mapNotificationJobRow);
}
