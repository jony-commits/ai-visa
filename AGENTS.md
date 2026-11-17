# AGENTS.md — Meridian Visa Coding Conventions & Boundaries

## 1. Repository Layout
- `/docs/` — Architecture, PRD, Database, API, Rule Engine, Security, and Implementation Plan.
- `/prisma/schema.prisma` — Canonical normalized PostgreSQL schema for production & Docker deployments.
- `/docker-compose.yml` — Local PostgreSQL, Redis, MinIO (S3), and Mailpit stack.
- `/server/` — Express REST API modules (`db.ts`, `crypto.ts`, `mfa.ts`, `middleware.ts`, `routes/*`, `workflow.ts`, `seed.ts`).
- `/server.ts` — Express + Vite dev/prod entrypoint listening on port `3000`.
- `/src/` — React 19 + TypeScript + Tailwind CSS v4 frontend SPA.
- `/tests/` — Automated integration & security tests run via `npm test`.

## 2. Package Scripts
- `npm run dev` — Starts Express + Vite dev server on `http://localhost:3000`.
- `npm run build` — Builds production frontend (`vite build`).
- `npm run lint` — TypeScript check (`tsc --noEmit`).
- `npm test` — Runs automated backend & tenant-isolation test suite (`tsx --test tests/*.test.ts`).

## 3. Architectural Boundaries
1. **Strict Tenant Isolation**: Never trust client-supplied `organizationId` on standard tenant operations. Always derive tenant context from `req.auth.organizationId` validated via `organization_members`.
2. **No Client-Side AI SDKs**: `@google/genai` must only ever be imported on the server under `/server/`. Never expose `GEMINI_API_KEY` or `APP_ENCRYPTION_KEY` to `src/`.
3. **Separate Workflow vs. Official Status**: `internal_status` tracks agency workflow; `government_status` tracks verified external updates with mandatory `government_status_source`. Never fabricate official updates.
4. **Encrypt Sensitive PII**: Passport numbers and MFA secrets must be encrypted with AES-256-GCM (`server/crypto.ts`) before DB storage and masked in default API responses.
5. **Audit Everything Security-Relevant**: Auth events, assignments, role updates, state transitions, and data exports must record an `audit_logs` row.
6. **UI Rules**: Maintain `@custom-variant dark` in `src/index.css`, tabular numerals on metrics/tables, zero-pill metadata, and never wrap status text solely in color without explicit labels.
