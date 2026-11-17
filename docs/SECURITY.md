# Security & Privacy Architecture — Meridian Visa Platform

## 1. Threat Model & Sensitive Data Classification
Visa applications store Tier-1 PII and financial/identity data (legal names, dates of birth, passport numbers, immigration history, bank statements).

## 2. Implemented Controls (Phases 1–6)
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
   - Analytics (`/api/analytics/overview`, `/api/analytics/ai-usage`) and audit log queries (`/api/audit-logs`) enforce strict role and tenant scoping; `scope=platform` is honored solely when `isPlatformAdmin === true`.
   - Internal consultant notes (`visibility = 'INTERNAL'`) are filtered out of applicant API responses.
5. **Private Storage, File Validation & Verification Isolation**:
   - Uploaded documents undergo magic-byte MIME verification, EICAR malware signature quarantine, and SHA-256 deduplication checks before entering OCR pipelines.
   - Stored documents live outside public webroots and are served solely via HMAC-signed, short-lived pre-signed download URLs; `QUARANTINED` files cannot be downloaded or officer-approved.
6. **Server-Side AI Isolation, Consent Gating & Anti-Fabrication Guards**:
   - `@google/genai` is isolated strictly under `/server/`; `GEMINI_API_KEY` is never exposed to client bundles.
   - External AI extraction and form suggestions require explicit `EXTERNAL_AI_PROCESSING` applicant consent and record prompt versions + token consumption in `ai_usage_logs`.
   - Untrusted OCR text is isolated from manual corrections (`raw_ocr_text` vs. `corrected_json`), and AI form suggestions require explicit user acceptance before saving or applicant declaration sign-off.
   - Any form modification after applicant sign-off automatically resets `applicant_approved = 0`.
   - `statusAdapter.ts` rejects manual attempts to spoof `sourceType = 'OFFICIAL_API'` (`400 Bad Request`) and never fabricates external embassy status updates; `submissionAdapter.ts` blocks restricted portal scraping or CAPTCHA bypasses.
7. **Immutable Audit Logging & Consent Enforcement**:
   - Security-relevant events (registrations, logins, MFA changes, invitations, role updates, case creation, assignments, status transitions, verification decisions, external status attribution, form approvals, tenant suspension, and data exports) write records to `audit_logs`.
   - Notification workers check `COMMUNICATIONS` consent prior to dispatch (`SKIPPED_NO_CONSENT`).
8. **Personal Data Export**:
   - Explicit consent flags (`PERSONAL_DATA_PROCESSING`, `EXTERNAL_AI_PROCESSING`, `COMMUNICATIONS`) tracked with policy version and timestamp.
   - Applicant self-service JSON export (`GET /api/applicant/export`).

## 3. Production Cutover Controls (Tracked in `/docs/DEPLOYMENT.md`)
- Private S3/MinIO bucket integration (`@aws-sdk/client-s3`) replacing single-node local private object directory.
- External ClamAV / ICAP daemon scanning and accredited KYC identity registry integration.
- Automated personal data retention & GDPR deletion execution (`POST /api/applicant/delete-request`).
- Authorized bilateral government API mTLS/OAuth integration (portal handoffs never store applicant government portal passwords).
