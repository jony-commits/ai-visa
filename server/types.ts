export const ORGANIZATION_ROLES = [
  'APPLICANT',
  'CONSULTANT',
  'VERIFICATION_OFFICER',
  'AGENCY_ADMIN',
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const INTERNAL_CASE_STATUSES = [
  'DRAFT',
  'APPLICANT_INFO_PENDING',
  'DOCUMENT_COLLECTION',
  'DOCUMENT_VERIFICATION',
  'FORM_PREPARATION',
  'CONSULTANT_REVIEW',
  'APPLICANT_APPROVAL',
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'AWAITING_APPOINTMENT_DECISION',
  'DECISION_RECEIVED',
  'CLOSED',
  'ADDITIONAL_INFO_REQUESTED',
  'RETURNED_FOR_CORRECTION',
  'ON_HOLD',
  'WITHDRAWN',
  'REJECTED',
  'APPROVED',
] as const;

export type InternalCaseStatus = (typeof INTERNAL_CASE_STATUSES)[number];

export const GOVERNMENT_STATUS_SOURCES = [
  'UNAVAILABLE',
  'CONSULTANT_MANUAL_UPDATE',
  'APPLICANT_UPLOADED_NOTICE',
  'AUTHORIZED_EMAIL_INGESTION',
  'PARTNER_INTEGRATION',
  'OFFICIAL_API',
] as const;

export type GovernmentStatusSource = (typeof GOVERNMENT_STATUS_SOURCES)[number];

export const CONSENT_TYPES = [
  'PERSONAL_DATA_PROCESSING',
  'EXTERNAL_AI_PROCESSING',
  'COMMUNICATIONS',
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

export interface AuthContext {
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
