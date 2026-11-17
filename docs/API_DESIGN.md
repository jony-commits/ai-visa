# API Design — Meridian Visa Platform

All endpoints are prefixed with `/api`, accept/return `application/json`, and enforce authentication via HttpOnly signed cookie (`meridian_session`) or `Authorization: Bearer <token>` header.

## 1. Health & Metadata
- `GET /api/health` — Returns service health and implemented module status.
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

## 3. Organizations, Invitations & RBAC (Module 1 & 13/14)
- `GET /api/organizations/current` — Returns active organization details.
- `PATCH /api/organizations/current` — Updates organization settings (`AGENCY_ADMIN` only).
- `GET /api/organizations/members` — Lists members within the active tenant (`AGENCY_ADMIN` / `CONSULTANT`).
- `POST /api/organizations/invitations` — Invites a consultant, verification officer, or admin (`AGENCY_ADMIN` only).
- `POST /api/invitations/accept` — Accepts an invitation token and adds/links user to the organization.
- `PATCH /api/organizations/members/:memberId/role` — Updates member role (`AGENCY_ADMIN` only; prevents cross-tenant modification).
- `GET /api/admin/tenants` — Lists all organizations (`SUPER_ADMIN` only).
- `PATCH /api/admin/tenants/:orgId/status` — Activates/suspends a tenant (`SUPER_ADMIN` only).

## 4. Applicant Onboarding & Consent (Module 1 & 18)
- `GET /api/applicant/profile` — Returns applicant profile, masked passport record (`••••1234`), and consent records.
- `PUT /api/applicant/profile` — Upserts applicant personal, travel, dependent, and encrypted passport details plus required consent acknowledgments.
- `GET /api/applicant/export` — Exports applicant profile, consents, and cases as portable JSON.

## 5. Visa Case Management & Workflow Engine (Module 2 & 8)
- `GET /api/cases` — Lists cases filtered by tenant, role (applicants see only their own), status, category, and search query.
- `POST /api/cases` — Creates a new visa application with unique reference number (`MRD-YYYY-XXXX`) and initial status history.
- `GET /api/cases/:id` — Returns full case details, status history, tasks, and role-appropriate notes (internal notes hidden from applicants).
- `PATCH /api/cases/:id/assign` — Assigns a consultant within the same organization (`AGENCY_ADMIN` only).
- `PATCH /api/cases/:id/transition` — Validates and executes workflow state transition, updating `application_status_history` and `audit_logs`.
- `PATCH /api/cases/:id/government-status` — Records consultant-verified external tracking reference and status source (never labeled as official API unless from an authorized API integration).
- `POST /api/cases/:id/tasks` — Creates a case task with assignee and due date.
- `PATCH /api/cases/:id/tasks/:taskId` — Updates task status (`OPEN`, `IN_PROGRESS`, `COMPLETED`).
- `POST /api/cases/:id/notes` — Adds an internal consultant note or applicant-visible message.

## 6. Security Audit Logs (Module 18)
- `GET /api/audit-logs` — Returns tenant-scoped security & workflow audit events (`AGENCY_ADMIN` / `SUPER_ADMIN`).
