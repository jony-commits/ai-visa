# Product Requirements Document (PRD) — Meridian Visa Platform

## 1. Product Vision
Meridian Visa is a multi-tenant, AI-assisted visa processing and immigration case management SaaS platform designed for immigration agencies, corporate mobility teams, travel consultants, and individual applicants. It centralizes applicant onboarding, version-controlled country visa rules, document collection, AI-assisted extraction and verification, dynamic form preparation, workflow orchestration, and verified status tracking under strict privacy and tenant isolation controls.

## 2. Core Principles & Guardrails
1. **No Fabricated Immigration Policy**: Legal requirements, eligibility rules, fees, and processing times must come from verified, versioned rule sets authored and approved by authorized staff—never hallucinated by an LLM.
2. **Human-in-the-Loop Verification**: AI extraction and consistency checks produce structured suggestions marked unverified until reviewed by an authorized officer or confirmed by the applicant. AI never certifies document authenticity from an image alone.
3. **Authorized Submission & Tracking Only**: Official portal submissions require explicit applicant/representative approval of the final reviewed package. Status updates always record and display their exact data source (official API, partner feed, verified notice, or manual consultant entry).
4. **Strict Multi-Tenant Data Isolation**: Agencies operate inside isolated tenant boundaries enforced at the API middleware, service, and database query layers.

## 3. User Personas & Roles
| Role | Primary Responsibilities | Scope |
| :--- | :--- | :--- |
| **Applicant** | Completes onboarding, grants consent, uploads documents, reviews prefilled forms, approves final submission, tracks progress. | Own profile and own cases only. |
| **Visa Consultant / Case Officer** | Reviews applicant intake, assigns tasks, reviews forms, communicates with applicants, advances workflow stages, prepares submission handoffs. | Assigned or tenant-scoped cases. |
| **Document Verification Officer** | Inspects OCR extractions, resolves flagged inconsistencies, approves or rejects uploaded documents, requests corrections. | Tenant-scoped cases. |
| **Agency Administrator** | Registers organization, invites/manages team members, assigns cases, views operational turnaround analytics, configures agency settings. | Own organization only. |
| **Platform Super Administrator** | Manages tenant lifecycle, global countries/categories, published rule versions, workflow templates, AI/queue health, and security audit logs. | Cross-tenant governance (audited). |

## 4. Phased Delivery Scope
- **Phase 1 (Current)**: Core foundation, authentication (email verification, password reset, MFA TOTP), multi-tenant organizations, RBAC, consultant invitations, applicant onboarding/consent/encrypted passport records, and core visa case management with state-machine workflow transitions.
- **Phase 2**: Country catalog configuration, version-controlled visa rule engine, dynamic document checklists, private signed object storage uploads, and malware scanning hooks.
- **Phase 3**: OCR provider abstraction, Gemini AI structured extraction, deterministic + AI cross-document consistency verification, and officer review queue.
- **Phase 4**: JSON Schema dynamic form wizard, AI-assisted prefilling (labeled suggestions), revision history, PDF/JSON export, and 3-mode portal submission handoff.
- **Phase 5**: BullMQ/Redis automated reminders & multi-channel notifications (Email/SMS/WhatsApp), verified status tracking sources, and appointment scheduling.
- **Phase 6**: Agency operational dashboards, bottleneck/turnaround analytics, Super Admin console, full E2E Playwright suite, and production hardening.

## 5. MVP Acceptance Criteria Mapping
1. Applicant registration & secure profile -> Phase 1 (`POST /api/auth/register`, `PUT /api/applicant/profile`)
2. Agency case creation & consultant assignment -> Phase 1 (`POST /api/cases`, `PATCH /api/cases/:id/assign`)
3. Route-specific document checklist -> Phase 2
4. Secure document upload -> Phase 2
5. AI extraction into reviewable structured data -> Phase 3
6. Flagging missing & inconsistent info -> Phase 3
7. Consultant document review & approval -> Phase 3
8. Dynamic visa form prefilled with verified data -> Phase 4
9. Applicant review & approval -> Phase 4
10. Authorized submission handoff -> Phase 4
11. Source-attributed status updates -> Phase 5
12. Event-driven notifications -> Phase 5
13. Automated tenant isolation & RBAC tests -> Phase 1 (`tests/phase1.test.ts`)
14. Local Docker Compose environment -> Documented & scaffolded (`docker-compose.yml`)
