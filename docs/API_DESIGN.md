# API Design — Meridian Visa Platform

All endpoints are prefixed with `/api`, accept/return `application/json`, and enforce authentication via HttpOnly signed cookie (`meridian_session`) or `Authorization: Bearer <token>` header.

## 1. Health & Metadata
- `GET /api/health` — Returns service health and implemented module status (`Phase 6`).
- `GET /api/catalog/routes` — Returns configured countries, visa categories, and clearly labeled demonstration visa routes.

## 2. Authentication & MFA (Module 1)
- `POST /api/auth/register` — Registers a new user (`APPLICANT` joining an agency or `AGENCY_ADMIN` creating a new organization). Issues an email verification token.
- `POST /api/auth/login` — Authenticates email/password. Returns `mfaRequired: true` + short-lived `mfaChallengeToken` if MFA is enabled, otherwise sets active session.
- `POST /api/auth/mfa/verify-login` — Completes login using a 6-digit TOTP code or backup code.
- `POST /api/auth/verify-email` — Verifies account email using token.
- `POST /api/auth/resend-verification` — Rotates email verification token.
- `POST /api/auth/forgot-password` — Generates a 1-hour password reset token.
- `POST /api/auth/reset-password` — Resets password using valid token and revokes active sessions.
- `POST /api/auth/logout` — Revokes current session token.
- `GET /api/auth/me` — Returns authenticated user, active organization, role, and MFA status.
- `POST /api/auth/mfa/setup` — Generates encrypted pending TOTP secret + `otpauth://` URI + backup codes.
- `POST /api/auth/mfa/enable` — Verifies TOTP code and activates MFA.
- `POST /api/auth/mfa/disable` — Disables MFA after password + TOTP verification.

## 3. Organizations, Invitations & RBAC (Modules 1, 13 & 14)
- `GET /api/organizations/current` — Returns active organization details.
- `PATCH /api/organizations/current` — Updates organization settings (`AGENCY_ADMIN` only).
- `GET /api/organizations/members` — Lists members within the active tenant (`AGENCY_ADMIN` / `CONSULTANT` / `VERIFICATION_OFFICER`).
- `POST /api/organizations/invitations` — Invites a consultant, verification officer, or admin (`AGENCY_ADMIN` only).
- `POST /api/invitations/accept` — Accepts an invitation token and adds/links user to the organization.
- `PATCH /api/organizations/members/:memberId/role` — Updates member role (`AGENCY_ADMIN` only; prevents cross-tenant modification).
- `GET /api/admin/tenants` — Lists all organizations with overdue SLA counts, open verification issues, failed notification counts, AI token totals, and queue summaries (`SUPER_ADMIN` only).
- `PATCH /api/admin/tenants/:orgId/status` — Activates/suspends a tenant (`SUPER_ADMIN` only).

## 4. Applicant Onboarding & Consent (Modules 1 & 18)
- `GET /api/applicant/profile` — Returns applicant profile, masked passport record (`••••1234`), and consent records.
- `PUT /api/applicant/profile` — Upserts applicant personal, travel, dependent, and encrypted passport details plus required consent acknowledgments.
- `PUT /api/applicant/consents` — Updates granular applicant consent flags (`PERSONAL_DATA_PROCESSING`, `EXTERNAL_AI_PROCESSING`, `COMMUNICATIONS`).
- `GET /api/applicant/export` — Exports applicant profile, consents, and cases as portable JSON.

## 5. Visa Case Management & Workflow Engine (Modules 2 & 8)
- `GET /api/cases` — Lists cases filtered by tenant, role (applicants see only their own), status, category, and search query.
- `POST /api/cases` — Creates a new visa application with unique reference number (`MRD-YYYY-XXXX`) and initial status history.
- `GET /api/cases/:id` — Returns full case details, status history, tasks, and role-appropriate notes (internal notes hidden from applicants).
- `PATCH /api/cases/:id/assign` — Assigns a consultant within the same organization (`AGENCY_ADMIN` only).
- `PATCH /api/cases/:id/transition` — Validates and executes workflow state transition, updating `stage_due_at`, `application_status_history`, `notification_jobs`, and `audit_logs`.
- `PATCH /api/cases/:id/government-status` — Records consultant-verified external tracking reference and status source (blocks spoofing `OFFICIAL_API`).
- `POST /api/cases/:id/tasks` / `PATCH /api/cases/:id/tasks/:taskId` — Creates and updates case tasks.
- `POST /api/cases/:id/notes` — Adds an internal consultant note or applicant-visible message.

## 6. Documents, OCR Extraction & Cross-Document Verification (Modules 3, 4 & 5)
- `GET /api/cases/:id/documents` — Lists uploaded document versions, dynamic route checklist requirements, verification report, issues, and processing jobs.
- `POST /api/cases/:id/documents` & two-step pre-signed upload endpoints — Validates magic bytes, scans malware signatures, runs OCR/Gemini extraction, and executes deterministic cross-document checks.
- `POST /api/documents/:docId/extract` & `PATCH /api/documents/:docId/extraction` — Re-runs OCR or records human-confirmed field corrections while preserving immutable `raw_ocr_text`.
- `PATCH /api/documents/:docId/review` — Records Verification Officer / Staff decision (`VERIFIED`, `NEEDS_CORRECTION`, `REJECTED`); blocks verification on `QUARANTINED` files.
- `GET /api/verification/queue` — Lists tenant-scoped documents and consistency issues for Verification Officers and staff.
- `PATCH /api/verification-issues/:issueId` — Resolves or overrides a verification discrepancy with an audit note.

## 7. Dynamic Forms & Submission Handoff (Modules 6 & 7)
- `GET /api/cases/:id/forms` — Resolves versioned JSON Schema, current answers, source attributions, AI draft suggestions, and submission adapter capabilities.
- `PUT /api/cases/:id/forms/draft` — Saves step revisions or auto-save snapshots; resets prior applicant approval when answers change.
- `POST /api/cases/:id/forms/prefill` — Populates verified profile, decrypted passport, and human-confirmed document extractions.
- `POST /api/cases/:id/forms/ai-suggest` & `PATCH /api/cases/:id/forms/ai-suggestions/:fieldKey` — Generates consent-gated AI draft suggestions marked `Review Required` and records `ACCEPT` / `DISMISS` decisions.
- `POST /api/cases/:id/forms/approve` — Validates completeness + zero pending AI suggestions and records owning applicant attestation.
- `GET /api/cases/:id/forms/export` — Exports form data as JSON or printable HTML summary.
- `POST /api/cases/:id/submission/handoff` & `POST /api/cases/:id/submission/:handoffId/confirm-manual` — Generates guided manual handoff packages or executes authorized API submission and records external filing receipts.

## 8. Configurable Workflows, Tracking, Appointments & Notifications (Modules 8, 9 & 10)
- `GET /api/workflows/stages` & `PATCH /api/workflows/stages/:stageCode` — Reads and customizes per-organization (and per-visa-category) workflow stage labels, SLAs, transitions, and notifications.
- `GET /api/cases/:id/status-tracking`, `POST /api/cases/:id/status-events`, `POST /api/cases/:id/status-sync` — Inspects separated external status, records source-attributed manual updates, or queries configured official APIs.
- `PATCH /api/cases/:id/deadlines` & `GET /api/cases/:id/timeline` — Updates case deadlines/stage SLAs and fetches unified chronological timeline.
- `GET/POST /api/cases/:id/appointments` & `PATCH /api/cases/:id/appointments/:apptId` — Schedules, reschedules, completes, or cancels appointments with automated notification queuing.
- `GET/PATCH /api/notifications/templates`, `POST /api/notifications/run-worker`, `POST /api/notifications/:jobId/retry` — Manages tenant Email/SMS templates and BullMQ-compatible retry dispatch.

## 9. Operational Analytics, AI Usage & Security Audit Logs (Modules 11–18)
- `GET /api/analytics/overview?scope=tenant|platform` — Returns role-scoped operational KPIs, SLA risk counts, stage bottlenecks, staff workload, upcoming appointments, queue health, and applicant readiness.
- `GET /api/analytics/ai-usage?scope=tenant|platform` — Returns live Gemini API availability, call/token totals, engine breakdown, and recent AI telemetry (`CONSULTANT`, `VERIFICATION_OFFICER`, `AGENCY_ADMIN`, and `SUPER_ADMIN`).
- `GET /api/audit-logs?action=&resourceType=&search=&limit=` — Returns filtered, tenant-scoped security & workflow audit events (`AGENCY_ADMIN` / `VERIFICATION_OFFICER` / `SUPER_ADMIN`).
