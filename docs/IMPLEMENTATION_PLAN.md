# Implementation Plan — Meridian Visa Platform

## Execution Status Tracker

### Phase 1: Core Foundation, Auth, Organizations, Profiles & Visa Case Management
- [x] **Task 1.1 — Repository Inspection & Architecture Docs**: Created PRD, System Architecture, Database Design, API Design, Visa Rule Engine, Security, Implementation Plan, and `AGENTS.md`.
- [x] **Task 1.2 — Database Schema & Production Topology**: Created `prisma/schema.prisma`, `docker-compose.yml`, and executable relational schema in `server/db.ts` (`node:sqlite`).
- [x] **Task 1.3 — Auth, Email Verification, Password Reset, TOTP MFA & Field Encryption**: Implemented `scrypt` hashing, SHA-256 token hashing, AES-256-GCM field encryption, RFC 6238 TOTP MFA, and session management.
- [x] **Task 1.4 — Multi-Tenant Organizations, Invitations & RBAC**: Implemented organization creation, member listing, consultant invitations, role management, and tenant-isolation middleware.
- [x] **Task 1.5 — Applicant Onboarding, Consents & Encrypted Passport Records**: Implemented 4-step onboarding wizard, strict server-side validation (`server/validation.ts`), dependent list, consent records, masked AES-256-GCM passport responses, and GDPR JSON export.
- [x] **Task 1.6 — Visa Case Management, Country/Category Selection & Assignment**: Implemented configurable country & visa category selection, staff-initiated case creation, consultant assignment/unassignment (`AGENCY_ADMIN`), valid/invalid workflow transitions, separation of `internalStatus` vs `governmentStatus`, tasks, internal/applicant notes, and audit logging.
- [x] **Task 1.7 — Enterprise SaaS UI (Phase 1)**: Built responsive light/dark workspace with Auth/MFA portal, Overview, Visa Cases (Table + Kanban + Country/Category Wizard + Case Detail), 4-Step Applicant Onboarding, Team & Organization Management, Security & MFA Settings, Audit Logs, and Roadmap.
- [x] **Task 1.8 — Automated Authorization, Validation & Tenant-Isolation Test Suite**: Verified registration, MFA, encryption at rest, onboarding validation, case assignment RBAC, same-tenant applicant isolation, and cross-tenant isolation via `tests/phase1.test.ts` and `tests/onboarding_cases.test.ts`.

### Phase 2: Country Configuration, Versioned Visa Rules, Checklists & Secure Uploads
- [x] **Task 2.1 — Admin Rule & Dynamic Form Builder (`DRAFT` -> `IN_REVIEW` -> `PUBLISHED`)**: Implemented `server/routes/rulesAndForms.ts`, `RuleFormBuilderView.tsx`, and `tests/rules_form_builder.test.ts` with organization-isolated rule/form schema authoring, conditional checklist triggers (`ALWAYS`, `HAS_DEPENDENTS`, `STAY_OVER_30_DAYS`), official source verification guards, and live rule simulation.
- [x] Country adapter execution generating dynamic document checklists (`syncChecklistForCase` supporting route, visa category & dependents)
- [x] Private S3-compatible & HMAC-signed local object storage with magic-byte validation, SHA-256 deduplication & malware scanning hook

### Phase 3: OCR, AI Document Extraction & Consistency Verification
- [x] OCR provider abstraction (`runDocumentOcr`) & `@google/genai` server-side extraction pipeline (`normalizeDocumentWithGemini` gated by `EXTERNAL_AI_PROCESSING` consent) with BullMQ-compatible `processing_jobs`
- [x] Field extraction review UI with confidence indicators, evidence snippets, immutable `raw_ocr_text` & manual correction/confirmation workflow
- [x] Multi-layer deterministic cross-document consistency validation, expiration/Schengen checks, verification officer review queue & `verification_issues` resolution

### Phase 4: Dynamic Forms, AI Form Prefill & Authorized Submission Handoff
- [x] Versioned country-specific JSON Schema multi-step wizard with conditional fields, auto-save & revision history (`server/services/formSchemas.ts`, `server/services/formEngine.ts`)
- [x] Verified data prefill + consent-gated AI suggestions clearly marked for review, gated by applicant approval & HTML/JSON summary export
- [x] Submission adapter interface (`AuthorizedOfficialApiAdapter` & `GuidedManualHandoffAdapter`) with strict block against restricted portal automation/CAPTCHA bypass

### Phase 5: Workflow Automation, Status Tracking & Notifications
- [x] Configurable per-organization workflow stages (`organization_workflow_stages`), SLA calculation, deadlines (`target_submission_deadline`, `stage_due_at`) & unified chronological timeline (`server/workflow.ts`, `server/routes/workflowTracking.ts`)
- [x] BullMQ-compatible notification workers (`server/services/notifications.ts`, `notification_jobs`), consent-gated Email/SMS dispatch, exponential retry backoff, permanent failure dead-lettering & customizable tenant templates (`WorkflowTemplatesView.tsx`)
- [x] Authorized official status adapter contracts (`server/services/statusAdapter.ts`), source-attributed manual updates with verification timestamps (`government_status_verified_at`, `status_tracking_events`), non-fabrication guards & appointment calendar (`CaseTrackingPanel.tsx`, `tests/workflow_notifications.test.ts`)

### Phase 6: Analytics, Super Admin Console & Production Hardening
- [x] **Task 6.1 — Role Dashboards & Agency Operational Analytics**: Delivered `RoleDashboardView.tsx` and `/api/analytics/overview` + `/api/analytics/ai-usage` (`server/routes/analytics.ts`, `tests/analytics_admin.test.ts`) with Applicant, Consultant, Verification Officer, Agency Admin, and Super Admin operational KPIs, turnaround/bottleneck telemetry, workload capacity, AI token/OCR engine metrics, and explicit loading/empty/retryable error states.
- [x] **Task 6.2 — Super Admin Tenant, Queue, Rule & AI Governance Console**: Delivered cross-tenant `SUPER_ADMIN` governance views (`/api/analytics/superadmin`), per-tenant organization KPIs, processing/notification queue health, demo/catalog rule coverage, AI token tracking, and seamless `Platform Governance` vs `Active Tenant` isolation toggle.
- [x] **Task 6.3 — Playwright E2E Suite & Deployment Security Hardening**: Delivered isolated headless Chromium lifecycle tests (`playwright.config.ts`, `tests/e2e/visa-lifecycle.spec.ts`), updated `docs/DEPLOYMENT.md` with environment/Docker/RBAC hardening checklists and remaining external integration blockers, and verified `npm run lint`, `npm run build`, `npm test`, and `npm run test:e2e`.
