# System Architecture — Meridian Visa Platform

## 1. Architectural Overview
Meridian Visa uses a modular full-stack TypeScript architecture designed to run seamlessly both in local single-process development (Express + Vite SSR/HMR middleware on port 3000) and in containerized multi-service production (PostgreSQL, Redis/BullMQ, S3-compatible object storage, and stateless API/worker nodes).

```
+-------------------------------------------------------------------+
|                     React 19 + Tailwind CSS v4                    |
|  Applicant Workspace | Consultant Kanban | Admin & Super Admin    |
+---------------------------------+---------------------------------+
                                  | HTTPS / JSON + HttpOnly Cookie / Bearer
+---------------------------------v---------------------------------+
|                    Express REST API (server.ts)                   |
|  Auth & MFA | RBAC & Tenant Guard | Cases | Rules | AI Proxy      |
+--------+-------------------+-------------------+------------------+
         |                   |                   |
+--------v--------+ +--------v--------+ +--------v------------------+
| Relational DB   | | Object Storage  | | AI & OCR Abstraction      |
| SQLite (dev) /  | | Local Private / | | @google/genai (Server)    |
| Postgres+Prisma | | S3 Signed URLs  | | Prompt Versioning + Logs  |
+-----------------+ +-----------------+ +---------------------------+
```

## 2. Runtime Alignment
- **Interactive Preview / AI Studio Runtime**: `server.ts` serves the REST API under `/api/*` and mounts Vite middleware on port `3000` (with `node:sqlite` zero-dependency relational persistence stored in `./data/meridian.db` for immediate local execution).
- **Production / Docker Compose Runtime**: `docker-compose.yml` and `prisma/schema.prisma` define the target PostgreSQL 16 + Redis 7 + MinIO (S3-compatible) + Mailpit topology for scalable horizontally deployed API and BullMQ background worker processes.

## 3. Core Backend Boundaries
1. **Auth & Session Layer (`server/auth.ts`, `server/mfa.ts`)**:
   - `scrypt` password hashing with unique per-user 16-byte salts.
   - Signed session tokens stored in `sessions` table with expiry, revocation, and IP/User-Agent metadata.
   - RFC 6238 TOTP MFA enrollment and challenge verification.
2. **Tenant & RBAC Guard (`server/middleware.ts`)**:
   - Resolves authenticated user and active organization membership.
   - Enforces `requireAuth`, `requireRole(...)`, and `requireTenantScope(...)` before route handlers execute.
3. **Cryptographic Protection (`server/crypto.ts`)**:
   - AES-256-GCM field-level encryption for sensitive PII (passport numbers, TOTP secrets) using a server-side key (`APP_ENCRYPTION_KEY`), storing `{iv, authTag, ciphertext}` payloads.
4. **Domain Services (`server/routes/*`)**:
   - Strictly separate `internalStatus` (workflow state machine) from `governmentStatus` (source-verified external state).
   - Every state change, assignment, role change, or sensitive access writes an immutable entry to `audit_logs`.
5. **AI Abstraction Boundary (Phases 3–4)**:
   - Server-only `@google/genai` client (`gemini-4-hydrogen` / structured JSON schema).
   - Treats all AI outputs as unverified drafts requiring human verification.

## 4. Frontend Architecture (`src/`)
- Single-page React 19 application with modular domain views (`AuthPortal`, `RoleDashboardView`, `CasesView`, `CaseDetailPanel`, `CaseDocumentsPanel`, `CaseFormPanel`, `CaseTrackingPanel`, `VerificationQueueView`, `WorkflowTemplatesView`, `ApplicantProfileView`, `TeamAdminView`, `SecurityAuditView`, `RoadmapView`).
- Centralized API client (`src/lib/api.ts`) with typed DTOs and automatic session/error handling with explicit loading, empty, and retryable error states.
- Dual-theme CSS architecture (`@custom-variant dark` + semantic surface tokens, `.tabular-nums` alignment, and explicit label + tone state signaling).

## 5. Deployment & External Integration Boundaries
- See `/docs/DEPLOYMENT.md` for single-process vs. multi-service deployment commands, required environment variables, verification gates, and external integration blockers (`PostgreSQL/Redis`, `S3`, live `GEMINI_API_KEY`, official consular APIs, and SMTP/SMS gateways).

