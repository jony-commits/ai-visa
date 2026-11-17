export type OrganizationRole =
  | 'APPLICANT'
  | 'CONSULTANT'
  | 'VERIFICATION_OFFICER'
  | 'AGENCY_ADMIN';

export type InternalCaseStatus =
  | 'DRAFT'
  | 'APPLICANT_INFO_PENDING'
  | 'DOCUMENT_COLLECTION'
  | 'DOCUMENT_VERIFICATION'
  | 'FORM_PREPARATION'
  | 'CONSULTANT_REVIEW'
  | 'APPLICANT_APPROVAL'
  | 'READY_FOR_SUBMISSION'
  | 'SUBMITTED'
  | 'AWAITING_APPOINTMENT_DECISION'
  | 'DECISION_RECEIVED'
  | 'CLOSED'
  | 'ADDITIONAL_INFO_REQUESTED'
  | 'RETURNED_FOR_CORRECTION'
  | 'ON_HOLD'
  | 'WITHDRAWN'
  | 'REJECTED'
  | 'APPROVED';

export interface AuthUser {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  isPlatformAdmin: boolean;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
}

export interface VisaCountryItem {
  code: string;
  name: string;
  region: string;
}

export interface VisaCategoryItem {
  code: string;
  name: string;
  description: string;
}

export interface VisaRouteItem {
  id: string;
  destination_country: string;
  visa_category_code: string;
  title: string;
  rule_version: string;
  is_demo_rule: number;
  official_source_url: string | null;
  source_verified_at: string | null;
  effective_from: string;
  summary: string;
  country_name: string;
  category_name: string;
}

export interface VisaCase {
  id: string;
  reference_number: string;
  organization_id: string;
  organization_name?: string;
  applicant_user_id: string;
  applicant_name: string;
  applicant_email: string;
  assigned_consultant_id: string | null;
  consultant_name: string | null;
  route_id: string | null;
  route_title: string;
  is_demo_rule: number;
  destination_country: string;
  destination_country_name?: string;
  origin_country: string;
  nationality: string;
  visa_category: string;
  visa_category_name?: string;
  rule_version: string;
  internal_status: InternalCaseStatus;
  government_status: string;
  government_status_source: string;
  government_tracking_ref: string | null;
  government_status_verified_at?: string | null;
  target_submission_deadline?: string | null;
  stage_due_at?: string | null;
  intended_travel_date: string | null;
  purpose_of_travel?: string | null;
  appointment_at: string | null;
  submission_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseHistoryItem {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_by_name: string;
  reason: string | null;
  created_at: string;
}

export interface CaseTaskItem {
  id: string;
  title: string;
  description: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  due_at: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
  created_at: string;
}

export interface CaseNoteItem {
  id: string;
  author_name: string;
  visibility: 'INTERNAL' | 'APPLICANT_VISIBLE';
  body: string;
  created_at: string;
}

export interface OrganizationMember {
  member_id: string;
  user_id: string;
  role: OrganizationRole;
  status: string;
  email: string;
  full_name: string;
  email_verified: number;
  mfa_enabled: number;
  created_at: string;
}

export interface InvitationItem {
  id: string;
  email: string;
  role: OrganizationRole;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface AuditLogItem {
  id: string;
  organization_id: string | null;
  organization_name?: string;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata_json: string | null;
  created_at: string;
}

export const STATUS_LABELS: Record<InternalCaseStatus, string> = {
  DRAFT: 'Draft',
  APPLICANT_INFO_PENDING: 'Applicant Info Pending',
  DOCUMENT_COLLECTION: 'Document Collection',
  DOCUMENT_VERIFICATION: 'Document Verification',
  FORM_PREPARATION: 'Form Preparation',
  CONSULTANT_REVIEW: 'Consultant Review',
  APPLICANT_APPROVAL: 'Applicant Approval',
  READY_FOR_SUBMISSION: 'Ready for Submission',
  SUBMITTED: 'Submitted',
  AWAITING_APPOINTMENT_DECISION: 'Awaiting Decision',
  DECISION_RECEIVED: 'Decision Received',
  CLOSED: 'Closed',
  ADDITIONAL_INFO_REQUESTED: 'Additional Info Requested',
  RETURNED_FOR_CORRECTION: 'Returned for Correction',
  ON_HOLD: 'On Hold',
  WITHDRAWN: 'Withdrawn',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
};

export const ROLE_LABELS: Record<string, string> = {
  APPLICANT: 'Applicant',
  CONSULTANT: 'Visa Consultant',
  VERIFICATION_OFFICER: 'Verification Officer',
  AGENCY_ADMIN: 'Agency Administrator',
  SUPER_ADMIN: 'Platform Super Admin',
};

export interface DocumentRequirementItem {
  id: string;
  application_id: string;
  organization_id: string;
  requirement_code: string;
  title: string;
  description: string;
  document_type: string;
  is_mandatory: number;
  condition_note: string | null;
  status: 'MISSING' | 'UPLOADED' | 'VERIFIED' | 'NEEDS_CORRECTION' | 'REJECTED';
  created_at: string;
  updated_at: string;
}

export interface ExtractionStructuredPayload {
  fields: Record<string, string>;
  fieldConfidences?: Record<string, number>;
  unreadableOrIncomplete?: boolean;
  missingPagesDetected?: boolean;
  readabilityNotes?: string;
  evidenceSnippets?: string[];
  externalAiConsentGranted?: boolean;
  manuallyEditedBy?: string;
  manuallyEditedAt?: string;
}

export interface DocumentExtractionItem {
  id: string;
  ocrProvider: string;
  aiProvider: string;
  modelName: string;
  promptVersion: string;
  rawOcrText: string;
  detectedDocumentType: string;
  extracted: ExtractionStructuredPayload | null;
  corrected: ExtractionStructuredPayload | null;
  confidenceScore: number;
  isConfirmed: boolean;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  aiDisclaimer: string;
  updatedAt: string;
}

export interface ApplicationDocumentItem {
  id: string;
  applicationId: string;
  organizationId: string;
  requirementCode: string | null;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256Checksum: string;
  version: number;
  storageProvider: string;
  storageBucket: string;
  expiryDate: string | null;
  malwareScanStatus: 'PENDING' | 'CLEAN' | 'QUARANTINED';
  reviewStatus: 'PENDING' | 'EXTRACTED' | 'VERIFIED' | 'NEEDS_CORRECTION' | 'REJECTED';
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  uploadedByUserId: string;
  uploadedByName: string | null;
  createdAt: string;
  updatedAt: string;
  signedDownloadUrl: string;
  signedDownloadExpiresAt: string;
  extraction: DocumentExtractionItem | null;
}

export interface DocumentVerificationSummary {
  id: string;
  application_id: string;
  organization_id: string;
  formatting_status: string;
  extraction_status: string;
  consistency_status: string;
  external_identity_status: string;
  manual_officer_status: string;
  summary_note: string | null;
  verified_at: string | null;
  updated_at: string;
}

export interface VerificationIssueItem {
  id: string;
  verification_id: string;
  application_id: string;
  organization_id: string;
  source_document_id: string | null;
  source_filename?: string | null;
  issue_type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  verification_layer: string;
  evidence: string;
  explanation: string;
  suggested_correction: string;
  status: 'OPEN' | 'RESOLVED' | 'OVERRIDDEN';
  resolved_by_user_id: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessingJobItem {
  id: string;
  queue_name: string;
  job_name: string;
  bullmq_job_id: string | null;
  document_id: string | null;
  status: 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED';
  attempts: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface VerificationQueueDocument {
  id: string;
  application_id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  malware_scan_status: string;
  review_status: string;
  version: number;
  created_at: string;
  reference_number: string;
  destination_country: string;
  visa_category: string;
  applicant_name: string;
  confidence_score: number | null;
  detected_document_type: string | null;
  is_confirmed: number | null;
}

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  PASSPORT: 'Passport Bio Page',
  PASSPORT_PHOTO: 'Biometric Photo',
  BANK_STATEMENT: 'Bank Statement',
  EMPLOYMENT_LETTER: 'Employment Letter',
  PAYSLIP: 'Payslip',
  TRAVEL_INSURANCE: 'Travel Medical Insurance',
  TRAVEL_ITINERARY: 'Travel Itinerary & Lodging',
  ADMISSION_LETTER: 'Admission Letter',
  INVITATION_LETTER: 'Invitation Letter',
  BIRTH_MARRIAGE_CERT: 'Birth / Marriage Certificate',
  OTHER: 'Supporting Document',
};

export interface FieldCondition {
  field: string;
  equals?: string | boolean | number;
  in?: Array<string | boolean | number>;
  truthy?: boolean;
}

export interface JsonSchemaFieldSpec {
  type: 'string' | 'number' | 'boolean' | 'date';
  title: string;
  description?: string;
  placeholder?: string;
  enum?: Array<{ value: string; label: string }>;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'textarea' | 'country' | 'currency' | 'email';
  stepId: string;
  required?: boolean;
  visibleWhen?: FieldCondition;
  requiredWhen?: FieldCondition;
  aiSuggestible?: boolean;
  sensitiveMasked?: boolean;
}

export interface FormStepDefinition {
  id: string;
  title: string;
  description: string;
  order: number;
}

export interface VisaFormJsonSchema {
  $schema: string;
  schemaKey: string;
  version: string;
  title: string;
  destinationCountry: string;
  visaCategoryCode: string;
  isDemoRule: boolean;
  officialSourceUrl: string | null;
  steps: FormStepDefinition[];
  properties: Record<string, JsonSchemaFieldSpec>;
  required: string[];
}

export interface AiFieldSuggestionItem {
  fieldKey: string;
  suggestedValue: string;
  rationale: string;
  confidence: number;
  status: 'PENDING_REVIEW' | 'ACCEPTED' | 'DISMISSED';
  provider: string;
  model: string;
  reviewRequired: true;
  generatedAt: string;
  reviewedAt?: string;
}

export interface ApplicationFormDetail {
  id: string;
  applicationId: string;
  organizationId: string;
  schemaKey: string;
  schemaVersion: string;
  currentStep: number;
  answers: Record<string, unknown>;
  sourceAttribution: Record<string, string>;
  aiSuggestions: Record<string, AiFieldSuggestionItem>;
  validationErrors: Array<{ fieldKey: string; stepId: string; message: string }>;
  missingRequiredCount: number;
  completedRequiredFields: number;
  totalRequiredVisible: number;
  isComplete: boolean;
  applicantApproved: boolean;
  applicantApprovedByUserId: string | null;
  applicantApprovedAt: string | null;
  applicantAttestationText: string | null;
  revisionNumber: number;
  lastAutosavedAt: string | null;
  updatedAt: string;
}

export interface FormRevisionItem {
  id: string;
  revision_number: number;
  change_reason: string | null;
  changed_by_name: string;
  created_at: string;
}

export interface SubmissionCapabilityReport {
  adapterId: string;
  mode: 'AUTHORIZED_OFFICIAL_API' | 'GUIDED_MANUAL_HANDOFF';
  displayName: string;
  available: boolean;
  requiresOfficialPartnership: boolean;
  automationPolicy: string;
  reason: string;
  targetPortalUrl: string | null;
}

export interface SubmissionHandoffItem {
  id: string;
  adapter_id: string;
  submission_mode: string;
  status: string;
  external_portal_url: string | null;
  external_confirmation_ref: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  created_at: string;
  handoffPackage: {
    referenceNumber?: string;
    schemaVersion?: string;
    automationGuardrail?: string;
    checklistSteps?: string[];
    sections?: Array<{
      stepId: string;
      stepTitle: string;
      fields: Array<{ fieldKey: string; label: string; value: unknown; source: string }>;
    }>;
  } | null;
}

export interface WorkflowStageConfigItem {
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

export interface CaseAppointmentItem {
  id: string;
  application_id: string;
  organization_id: string;
  appointment_type: 'BIOMETRICS' | 'CONSULATE_INTERVIEW' | 'MEDICAL_EXAM' | 'PASSPORT_COLLECTION';
  center_name: string;
  center_address: string | null;
  scheduled_at: string;
  timezone: string;
  booking_reference: string | null;
  status: 'SCHEDULED' | 'RESCHEDULED' | 'COMPLETED' | 'CANCELLED';
  instructions: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatusTrackingEventItem {
  id: string;
  application_id: string;
  status_category: string;
  status_text: string;
  source_type: string;
  tracking_reference: string | null;
  adapter_id: string | null;
  raw_evidence_note: string | null;
  verified_by_name?: string | null;
  verified_at: string;
  created_at: string;
}

export interface StatusAdapterContractItem {
  adapterId: string;
  displayName: string;
  sourceType: string;
  connected: boolean;
  available: boolean;
  pollingPolicy: string;
  reason: string;
  targetPortalUrl: string | null;
}

export interface StatusTrackingOverview {
  applicationId: string;
  referenceNumber: string;
  internalStatus: string;
  governmentStatus: string;
  governmentStatusSource: string;
  governmentTrackingRef: string | null;
  governmentStatusVerifiedAt: string | null;
  targetSubmissionDeadline: string | null;
  stageDueAt: string | null;
  appointmentAt: string | null;
  adapterContracts: StatusAdapterContractItem[];
  events: StatusTrackingEventItem[];
}

export interface TimelineEventItem {
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
}

export interface NotificationTemplateItem {
  id: string;
  organizationId: string;
  templateKey: string;
  channel: 'EMAIL' | 'SMS';
  eventTrigger: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  isActive: boolean;
  isCustomOverride: boolean;
  updatedAt: string;
}

export interface NotificationJobItem {
  id: string;
  organizationId: string;
  applicationId: string | null;
  recipientUserId: string | null;
  recipientContact: string;
  channel: 'EMAIL' | 'SMS';
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

export interface AnalyticsOverviewData {
  scope: 'tenant' | 'platform';
  role: string;
  isPlatformAdmin: boolean;
  summary: {
    totalCases: number;
    activeCases: number;
    pendingApplicantAction: number;
    inReviewOrReady: number;
    submittedOrDecided: number;
    unassignedCases: number;
    assignedToMeCount: number;
    overdueSlaCount: number;
    dueWithin48hCount: number;
    avgTurnaroundHours: number | null;
    hasCompletedCases: boolean;
    openTasksCount: number;
    upcomingAppointmentsCount: number;
    pendingDocumentsCount: number;
    openVerificationIssuesCount: number;
    quarantinedDocsCount: number;
  };
  stageBreakdown: Array<{
    stageCode: string;
    count: number;
    overdueCount: number;
    avgAgeHours: number;
  }>;
  priorityCases: Array<{
    id: string;
    referenceNumber: string;
    applicantName: string;
    destinationCountry: string;
    visaCategory: string;
    internalStatus: InternalCaseStatus;
    consultantName: string | null;
    stageDueAt: string | null;
    targetSubmissionDeadline: string | null;
    slaState: 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'UNSET';
    actionReason: string;
  }>;
  consultantWorkload: Array<{
    userId: string;
    fullName: string;
    role: string;
    activeCount: number;
    overdueCount: number;
    dueSoonCount: number;
  }>;
  upcomingAppointments: Array<
    CaseAppointmentItem & {
      reference_number: string;
      applicant_name: string;
    }
  >;
  notificationDelivery: {
    scheduled: number;
    retryWait: number;
    delivered: number;
    failedPermanent: number;
    skippedNoConsent: number;
  };
  processingJobs: {
    queued: number;
    active: number;
    completed: number;
    failed: number;
  };
  applicantSummary: {
    onboardingCompleted: boolean;
    consentPersonal: boolean;
    consentAi: boolean;
    consentComms: boolean;
    missingMandatoryDocsCount: number;
    unapprovedCompleteFormsCount: number;
  } | null;
}

export interface AiUsageAnalyticsData {
  scope: 'tenant' | 'platform';
  geminiConfigured: boolean;
  totals: {
    totalCalls: number;
    successCount: number;
    failedCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
  };
  byModel: Array<{
    provider: string;
    model: string;
    prompt_version: string;
    call_count: number;
    success_count: number;
    failed_count: number;
    input_tokens: number;
    output_tokens: number;
  }>;
  extractionBreakdown: Array<{
    ai_provider: string;
    model_name: string;
    document_count: number;
    confirmed_count: number;
    avg_confidence: number | null;
  }>;
  byOrganization: Array<{
    organization_id: string;
    organization_name: string;
    call_count: number;
    failed_count: number;
    input_tokens: number;
    output_tokens: number;
  }>;
  recentLogs: Array<{
    id: string;
    organization_id: string;
    organization_name: string | null;
    user_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    application_id: string | null;
    reference_number: string | null;
    document_id: string | null;
    provider: string;
    model: string;
    prompt_version: string;
    input_tokens: number;
    output_tokens: number;
    status: string;
    created_at: string;
  }>;
}

export interface AdminTenantSummary {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  plan_tier: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  created_at: string;
  member_count: number;
  case_count: number;
  overdue_cases_count: number;
  open_issues_count: number;
  failed_notifications_count: number;
  ai_call_count: number;
  ai_total_tokens: number;
}

export type RuleConditionType = 'ALWAYS' | 'HAS_DEPENDENTS' | 'STAY_OVER_30_DAYS';
export type RuleApprovalStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'ARCHIVED';

export interface VisaRuleRequirementItem {
  requirementCode: string;
  title: string;
  description: string;
  documentType: string;
  isMandatory: boolean;
  conditionNote: string;
  conditionType?: RuleConditionType;
}

export interface VisaRuleRouteDetail {
  id: string;
  organization_id: string | null;
  organization_name?: string | null;
  destination_country: string;
  country_name: string;
  visa_category_code: string;
  category_name: string;
  title: string;
  rule_version: string;
  is_demo_rule: number | boolean;
  isDemoRule: boolean;
  official_source_url: string | null;
  source_verified_at: string | null;
  effective_from: string;
  summary: string;
  approvalStatus: RuleApprovalStatus;
  hasCustomRequirements: boolean;
  requirements: VisaRuleRequirementItem[];
}

export interface FormSchemaRecord {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  destinationCountry: string;
  visaCategoryCode: string;
  schemaKey: string;
  version: string;
  title: string;
  isDemoRule: boolean;
  officialSourceUrl: string | null;
  approvalStatus: RuleApprovalStatus;
  createdAt: string;
  approvedAt: string | null;
  schema: VisaFormJsonSchema;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function statusSemanticTone(status: string): string {
  if (
    [
      'APPROVED',
      'READY_FOR_SUBMISSION',
      'SUBMITTED',
      'VERIFIED',
      'PASSED',
      'CLEAN',
      'COMPLETED',
      'RESOLVED',
      'SUBMITTED_VIA_OFFICIAL_API',
      'CONFIRMED_MANUALLY',
      'HANDOFF_PACKAGE_READY',
      'DELIVERED',
      'SYNCED',
      'PUBLISHED',
    ].includes(status)
  ) {
    return 'text-emerald-700 dark:text-emerald-400';
  }
  if (
    [
      'RETURNED_FOR_CORRECTION',
      'ADDITIONAL_INFO_REQUESTED',
      'ON_HOLD',
      'APPLICANT_APPROVAL',
      'NEEDS_CORRECTION',
      'NEEDS_REVIEW',
      'WARNINGS',
      'WARNING',
      'CORRECTION_REQUESTED',
      'PENDING_REVIEW',
      'IN_REVIEW',
      'RETRY_WAIT',
      'RESCHEDULED',
      'SCHEDULED',
    ].includes(status)
  ) {
    return 'text-amber-700 dark:text-amber-400';
  }
  if (
    [
      'REJECTED',
      'WITHDRAWN',
      'FAILED',
      'FAILED_PERMANENT',
      'CRITICAL',
      'QUARANTINED',
      'MISSING',
      'UNAVAILABLE',
      'CANCELLED',
    ].includes(status)
  ) {
    return 'text-red-700 dark:text-red-400';
  }
  return 'text-slate-700 dark:text-slate-300';
}
