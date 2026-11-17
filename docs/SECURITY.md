# Security & Privacy Architecture — Meridian Visa Platform

## 1. Threat Model & Sensitive Data Classification
Visa applications store Tier-1 PII and financial/identity data (legal names, dates of birth, passport numbers, immigration history, bank statements).

## 2. Implemented Controls (Phase 1)
1. **Authentication & Password Storage**:
   - Passwords hashed with Node `crypto.scryptSync` (16-byte random salt, N=16384) and verified using `crypto.timingSafeEqual`.
   - Password reset and email verification tokens are cryptographically random (32 bytes) and stored hashed (`SHA-256`) in the database.
2. **Multi-Factor Authentication (MFA)**:
   - RFC 6238 TOTP (6-digit, 30s step) with encrypted TOTP seed at rest and single-use hashed backup codes.
3. **Field-Level Encryption at Rest**:
   - Passport numbers and TOTP secrets are encrypted via AES-256-GCM (`server/crypto.ts`) prior to persistence.
   - API responses return masked passport identifiers (`••••4821`) by default.
4. **Strict Multi-Tenant Isolation & RBAC**:
   - Every tenant resource validates `organizationId` from the authenticated session, never trusting client-supplied `organizationId` headers or body overrides for standard roles.
   - Role permissions enforced server-side for `APPLICANT`, `CONSULTANT`, `VERIFICATION_OFFICER`, `AGENCY_ADMIN`, and `SUPER_ADMIN`.
   - Internal consultant notes (`visibility = 'INTERNAL'`) are filtered out of applicant API responses.
5. **Audit Logging**:
   - Security-relevant events (registrations, logins, MFA changes, invitations, role updates, case creation, assignments, status transitions, data exports) write immutable records to `audit_logs`.
6. **Personal Data Export & Consent**:
   - Explicit consent flags (`PERSONAL_DATA_PROCESSING`, `EXTERNAL_AI_PROCESSING`, `COMMUNICATIONS`) tracked with policy version and timestamp.
   - Applicant self-service JSON export (`GET /api/applicant/export`).

## 3. Planned Controls (Phases 2–6)
- Private S3 bucket storage with short-lived pre-signed PUT/GET URLs (no public ACLs).
- ClamAV / malware scanning pipeline prior to OCR processing.
- Prompt injection isolation: untrusted OCR text wrapped in strict structural delimiters, schema-validated via Zod/Type, and never executed as instructions.
- Automated retention & personal data deletion workflows (`POST /api/applicant/delete-request`).
- Never storing government portal credentials in plaintext (portal handoff uses authorized OAuth/API tokens or guided applicant-owned submission).
