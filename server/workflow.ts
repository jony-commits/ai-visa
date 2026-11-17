import { AppDatabase, newId } from './db.ts';
import { INTERNAL_CASE_STATUSES, InternalCaseStatus, OrganizationRole } from './types.ts';

export const WORKFLOW_TRANSITIONS: Record<InternalCaseStatus, InternalCaseStatus[]> = {
  DRAFT: ['APPLICANT_INFO_PENDING', 'WITHDRAWN'],
  APPLICANT_INFO_PENDING: ['DOCUMENT_COLLECTION', 'ON_HOLD', 'WITHDRAWN'],
  DOCUMENT_COLLECTION: [
    'DOCUMENT_VERIFICATION',
    'ADDITIONAL_INFO_REQUESTED',
    'ON_HOLD',
    'WITHDRAWN',
  ],
  DOCUMENT_VERIFICATION: [
    'FORM_PREPARATION',
    'RETURNED_FOR_CORRECTION',
    'ADDITIONAL_INFO_REQUESTED',
    'ON_HOLD',
    'WITHDRAWN',
  ],
  FORM_PREPARATION: [
    'CONSULTANT_REVIEW',
    'RETURNED_FOR_CORRECTION',
    'ON_HOLD',
    'WITHDRAWN',
  ],
  CONSULTANT_REVIEW: [
    'APPLICANT_APPROVAL',
    'RETURNED_FOR_CORRECTION',
    'ADDITIONAL_INFO_REQUESTED',
    'ON_HOLD',
  ],
  APPLICANT_APPROVAL: [
    'READY_FOR_SUBMISSION',
    'RETURNED_FOR_CORRECTION',
    'WITHDRAWN',
  ],
  READY_FOR_SUBMISSION: ['SUBMITTED', 'RETURNED_FOR_CORRECTION', 'ON_HOLD'],
  SUBMITTED: ['AWAITING_APPOINTMENT_DECISION', 'DECISION_RECEIVED', 'ADDITIONAL_INFO_REQUESTED'],
  AWAITING_APPOINTMENT_DECISION: ['DECISION_RECEIVED', 'ADDITIONAL_INFO_REQUESTED'],
  DECISION_RECEIVED: ['APPROVED', 'REJECTED', 'CLOSED'],
  APPROVED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
  ADDITIONAL_INFO_REQUESTED: ['DOCUMENT_COLLECTION', 'DOCUMENT_VERIFICATION', 'FORM_PREPARATION', 'WITHDRAWN'],
  RETURNED_FOR_CORRECTION: ['APPLICANT_INFO_PENDING', 'DOCUMENT_COLLECTION', 'FORM_PREPARATION', 'WITHDRAWN'],
  ON_HOLD: ['APPLICANT_INFO_PENDING', 'DOCUMENT_COLLECTION', 'DOCUMENT_VERIFICATION', 'FORM_PREPARATION', 'WITHDRAWN'],
  WITHDRAWN: ['CLOSED'],
};

const DEFAULT_STAGE_LABELS: Record<InternalCaseStatus, string> = {
  DRAFT: 'Draft',
  APPLICANT_INFO_PENDING: 'Applicant Info Pending',
  DOCUMENT_COLLECTION: 'Document Collection',
  DOCUMENT_VERIFICATION: 'Document Verification',
  FORM_PREPARATION: 'Form Preparation',
  CONSULTANT_REVIEW: 'Consultant Review',
  APPLICANT_APPROVAL: 'Applicant Approval',
  READY_FOR_SUBMISSION: 'Ready for Submission',
  SUBMITTED: 'Submitted',
  AWAITING_APPOINTMENT_DECISION: 'Awaiting Appointment / Decision',
  DECISION_RECEIVED: 'Decision Received',
  CLOSED: 'Closed',
  ADDITIONAL_INFO_REQUESTED: 'Additional Info Requested',
  RETURNED_FOR_CORRECTION: 'Returned for Correction',
  ON_HOLD: 'On Hold',
  WITHDRAWN: 'Withdrawn',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
};

const DEFAULT_STAGE_SLA_HOURS: Partial<Record<InternalCaseStatus, number>> = {
  APPLICANT_INFO_PENDING: 72,
  DOCUMENT_COLLECTION: 120,
  DOCUMENT_VERIFICATION: 48,
  FORM_PREPARATION: 72,
  CONSULTANT_REVIEW: 48,
  APPLICANT_APPROVAL: 72,
  READY_FOR_SUBMISSION: 24,
  SUBMITTED: 360,
  AWAITING_APPOINTMENT_DECISION: 720,
};

const APPLICANT_ALLOWED_TARGETS = new Set<InternalCaseStatus>([
  'APPLICANT_INFO_PENDING',
  'DOCUMENT_COLLECTION',
  'READY_FOR_SUBMISSION',
  'WITHDRAWN',
]);

export interface WorkflowStageConfig {
  id: string;
  organizationId: string;
  visaCategory: string;
  stageCode: InternalCaseStatus;
  displayLabel: string;
  sortOrder: number;
  slaHours: number;
  enabled: boolean;
  allowedNextStages: InternalCaseStatus[];
  applicantAllowed: boolean;
  notifyOnEnter: boolean;
  updatedAt: string;
}

export function canTransitionCaseStatus(
  fromStatus: InternalCaseStatus,
  toStatus: InternalCaseStatus,
  actorRole: OrganizationRole,
  isPlatformAdmin: boolean,
): { allowed: boolean; reason?: string } {
  const validTargets = WORKFLOW_TRANSITIONS[fromStatus] || [];
  if (!validTargets.includes(toStatus)) {
    return {
      allowed: false,
      reason: `Transition from ${fromStatus} to ${toStatus} is not permitted by the workflow engine.`,
    };
  }

  if (actorRole === 'APPLICANT' && !isPlatformAdmin) {
    if (fromStatus === 'APPLICANT_APPROVAL' && toStatus === 'READY_FOR_SUBMISSION') {
      return { allowed: true };
    }
    if (!APPLICANT_ALLOWED_TARGETS.has(toStatus)) {
      return {
        allowed: false,
        reason: `Applicants cannot transition a case to ${toStatus}. Consultant or officer review is required.`,
      };
    }
  }

  return { allowed: true };
}

export function ensureOrgWorkflowStages(
  db: AppDatabase,
  organizationId: string,
  visaCategory = '*',
): void {
  const existing = db
    .prepare(
      'SELECT COUNT(*) AS count FROM organization_workflow_stages WHERE organization_id = ? AND visa_category = ?',
    )
    .get(organizationId, visaCategory) as { count: number };

  if (existing.count > 0) return;

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO organization_workflow_stages (
      id, organization_id, visa_category, stage_code, display_label, sort_order,
      sla_hours, enabled, allowed_next_stages_json, applicant_allowed, notify_on_enter, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?)
  `);

  INTERNAL_CASE_STATUSES.forEach((stageCode, idx) => {
    stmt.run(
      newId('wfs'),
      organizationId,
      visaCategory,
      stageCode,
      DEFAULT_STAGE_LABELS[stageCode],
      idx + 1,
      DEFAULT_STAGE_SLA_HOURS[stageCode] || 72,
      JSON.stringify(WORKFLOW_TRANSITIONS[stageCode] || []),
      APPLICANT_ALLOWED_TARGETS.has(stageCode) ? 1 : 0,
      now,
    );
  });
}

export function getOrgWorkflowStages(
  db: AppDatabase,
  organizationId: string,
  visaCategory = '*',
): WorkflowStageConfig[] {
  ensureOrgWorkflowStages(db, organizationId, '*');
  const targetCat =
    visaCategory !== '*'
      ? (db
          .prepare(
            'SELECT COUNT(*) AS count FROM organization_workflow_stages WHERE organization_id = ? AND visa_category = ?',
          )
          .get(organizationId, visaCategory) as { count: number }).count > 0
        ? visaCategory
        : '*'
      : '*';

  const rows = db
    .prepare(
      `
      SELECT * FROM organization_workflow_stages
      WHERE organization_id = ? AND visa_category = ?
      ORDER BY sort_order ASC
    `,
    )
    .all(organizationId, targetCat) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    organizationId: String(r.organization_id),
    visaCategory: String(r.visa_category),
    stageCode: String(r.stage_code) as InternalCaseStatus,
    displayLabel: String(r.display_label),
    sortOrder: Number(r.sort_order),
    slaHours: Number(r.sla_hours),
    enabled: Boolean(r.enabled),
    allowedNextStages: JSON.parse(String(r.allowed_next_stages_json || '[]')) as InternalCaseStatus[],
    applicantAllowed: Boolean(r.applicant_allowed),
    notifyOnEnter: Boolean(r.notify_on_enter),
    updatedAt: String(r.updated_at),
  }));
}

export function updateOrgWorkflowStage(
  db: AppDatabase,
  params: {
    organizationId: string;
    visaCategory?: string;
    stageCode: InternalCaseStatus;
    displayLabel?: string;
    slaHours?: number;
    enabled?: boolean;
    allowedNextStages?: InternalCaseStatus[];
    applicantAllowed?: boolean;
    notifyOnEnter?: boolean;
    updatedByUserId: string;
  },
): WorkflowStageConfig[] {
  const cat = params.visaCategory || '*';
  ensureOrgWorkflowStages(db, params.organizationId, '*');
  if (cat !== '*') {
    ensureOrgWorkflowStages(db, params.organizationId, cat);
  }

  if (
    params.enabled === false &&
    ['DRAFT', 'CLOSED', 'DOCUMENT_COLLECTION', 'SUBMITTED'].includes(params.stageCode)
  ) {
    throw new Error(`Core stage "${params.stageCode}" cannot be disabled.`);
  }

  if (params.allowedNextStages) {
    for (const target of params.allowedNextStages) {
      if (!INTERNAL_CASE_STATUSES.includes(target)) {
        throw new Error(`Invalid target stage "${target}".`);
      }
    }
  }

  const current = db
    .prepare(
      'SELECT * FROM organization_workflow_stages WHERE organization_id = ? AND visa_category = ? AND stage_code = ?',
    )
    .get(params.organizationId, cat, params.stageCode) as Record<string, unknown> | undefined;

  if (!current) {
    throw new Error(`Workflow stage "${params.stageCode}" not found.`);
  }

  const nextLabel = params.displayLabel?.trim() || String(current.display_label);
  const nextSla =
    typeof params.slaHours === 'number' && params.slaHours >= 1 && params.slaHours <= 8760
      ? Math.round(params.slaHours)
      : Number(current.sla_hours);
  const nextEnabled = params.enabled === undefined ? Number(current.enabled) : params.enabled ? 1 : 0;
  const nextAllowed = params.allowedNextStages
    ? JSON.stringify(params.allowedNextStages)
    : String(current.allowed_next_stages_json);
  const nextApplicantAllowed =
    params.applicantAllowed === undefined
      ? Number(current.applicant_allowed)
      : params.applicantAllowed
        ? 1
        : 0;
  const nextNotify =
    params.notifyOnEnter === undefined ? Number(current.notify_on_enter) : params.notifyOnEnter ? 1 : 0;

  db.prepare(`
    UPDATE organization_workflow_stages
    SET display_label = ?, sla_hours = ?, enabled = ?, allowed_next_stages_json = ?,
        applicant_allowed = ?, notify_on_enter = ?, updated_by_user_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    nextLabel,
    nextSla,
    nextEnabled,
    nextAllowed,
    nextApplicantAllowed,
    nextNotify,
    params.updatedByUserId,
    new Date().toISOString(),
    String(current.id),
  );

  return getOrgWorkflowStages(db, params.organizationId, cat);
}

export function canTransitionWithOrgConfig(
  db: AppDatabase,
  organizationId: string,
  visaCategory: string,
  fromStatus: InternalCaseStatus,
  toStatus: InternalCaseStatus,
  actorRole: OrganizationRole,
  isPlatformAdmin: boolean,
): { allowed: boolean; reason?: string; targetStage?: WorkflowStageConfig } {
  const stages = getOrgWorkflowStages(db, organizationId, visaCategory);
  const fromConfig = stages.find((s) => s.stageCode === fromStatus);
  const toConfig = stages.find((s) => s.stageCode === toStatus);

  if (toConfig && !toConfig.enabled) {
    return {
      allowed: false,
      reason: `Target stage "${toConfig.displayLabel}" is disabled in organization workflow configuration.`,
    };
  }

  const allowedTargets = fromConfig
    ? fromConfig.allowedNextStages
    : WORKFLOW_TRANSITIONS[fromStatus] || [];

  if (!allowedTargets.includes(toStatus)) {
    return {
      allowed: false,
      reason: `Transition from ${fromStatus} to ${toStatus} is not permitted by this organization's workflow rules.`,
    };
  }

  if (actorRole === 'APPLICANT' && !isPlatformAdmin) {
    if (fromStatus === 'APPLICANT_APPROVAL' && toStatus === 'READY_FOR_SUBMISSION') {
      return { allowed: true, targetStage: toConfig };
    }
    const applicantPermitted = toConfig
      ? toConfig.applicantAllowed
      : APPLICANT_ALLOWED_TARGETS.has(toStatus);
    if (!applicantPermitted) {
      return {
        allowed: false,
        reason: `Applicants cannot transition a case to ${toStatus}. Consultant or officer review is required.`,
      };
    }
  }

  return { allowed: true, targetStage: toConfig };
}

export function computeStageDueAt(slaHours: number): string {
  return new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
}
