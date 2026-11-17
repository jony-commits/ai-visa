# Deployment & Operations Guide — Meridian Visa Platform

## 1. Runtime Modes

### A. Single-Process Runtime (Local Development & AI Studio Preview)
Intended for single-host evaluation, automated tests, and interactive preview:
- **Entrypoint**: `server.ts` (Express REST API + Vite dev middleware on `PORT`, defaulting to `3000`, serving built `dist/` static assets when `NODE_ENV=production`).
- **Database**: `node:sqlite` zero-dependency relational store (`SQLITE_PATH`, default `./data/meridian.db`).
- **Private Storage**: Local private binary directory (`PRIVATE_STORAGE_DIR`, default `./data/private_objects`) accessed exclusively via HMAC-signed short-lived `/api/storage/signed/*` tokens.
- **Background Queues**: BullMQ-compatible relational queues (`processing_jobs` and `notification_jobs`) supporting delayed execution, exponential retry backoff, and dead-letter states (`FAILED_PERMANENT`).

Commands:
```bash
npm install
npm run lint        # TypeScript strict check (tsc --noEmit)
npm run build       # Build Vite production SPA to dist/
npm start           # Start Express + API + SPA on PORT (default 3000)
```

### B. Multi-Service Production Topology (`docker-compose.yml` + `prisma/schema.prisma`)
For horizontal multi-node production deployments:
1. **Database**: PostgreSQL 16 provisioned from `/prisma/schema.prisma` (`DATABASE_URL`).
2. **Queue & Cache**: Redis 7 (`REDIS_URL`) backing distributed BullMQ workers for OCR/AI normalization, verification checks, and delayed notification dispatch.
3. **Object Storage**: S3-compatible private bucket (AWS S3 / MinIO) via `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` with **Block Public Access** enabled and short-lived pre-signed URLs.
4. **Reverse Proxy / TLS**: Terminate HTTPS/TLS at ingress proxy so `meridian_session` cookies carry `Secure; HttpOnly; SameSite=Lax`.
5. **Email / SMS Transport**: Configure production SMTP/SendGrid/Twilio or `NOTIFICATION_WEBHOOK_URL` for outbox delivery.

---

## 2. Environment Variables Reference

| Variable | Required in Prod | Purpose |
| --- | --- | --- |
| `PORT` | Yes (default `3000`) | HTTP listen port for Express server |
| `NODE_ENV` | Yes (`production`) | Switches Vite middleware off and serves `dist/` |
| `APP_ENCRYPTION_KEY` | **Critical** | Master secret for AES-256-GCM encryption of passport numbers & TOTP MFA secrets |
| `SQLITE_PATH` | Dev/Single-node | Path to SQLite file (e.g. `./data/meridian.db`) |
| `PRIVATE_STORAGE_DIR` | Dev/Single-node | Local private object directory for uploaded documents |
| `DATABASE_URL` | Multi-service Prod | PostgreSQL 16 connection string for Prisma schema |
| `REDIS_URL` | Multi-service Prod | Redis 7 connection string for BullMQ queues |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Multi-service Prod | Private S3/MinIO object storage credentials |
| `GEMINI_API_KEY` | Optional (AI features) | Server-side `@google/genai` key; kept strictly off client bundles |
| `OFFICIAL_STATUS_API_URL` / `OFFICIAL_STATUS_API_KEY` | Optional (Partnered) | Authorized government/VAC status polling endpoint + bearer token |
| `OFFICIAL_VISA_API_URL` / `OFFICIAL_VISA_API_KEY` | Optional (Partnered) | Authorized government submission API endpoint + bearer token |
| `NOTIFICATION_WEBHOOK_URL` | Optional | Webhook dispatch endpoint for Email/SMS delivery workers |

---

## 3. Verification & Quality Gates

Before any release or deployment promotion, run all four gates:
1. `npm run lint` — TypeScript compilation check (`tsc --noEmit`).
2. `npm run build` — Vite production bundle verification (`dist/`).
3. `npm test` — Backend integration, RBAC, encryption, workflow, and tenant-isolation suite (`tests/*.test.ts`).
4. `npm run test:e2e` — End-to-end headless Chromium Playwright suite (`tests/e2e/visa-lifecycle.spec.ts`) executing on an isolated port (`3105`) and temporary database/storage directory so live dev data is untouched.

---

## 4. Production Security Hardening Checklist

- [ ] Set a cryptographically random 32+ byte `APP_ENCRYPTION_KEY` in secret management (never commit `.env`).
- [ ] Verify `@google/genai` and `GEMINI_API_KEY` remain strictly server-side under `/server/`.
- [ ] Ensure `trust proxy` and HTTPS TLS termination are active so `HttpOnly` session cookies and IP audit logs work accurately behind load balancers.
- [ ] Verify private S3 bucket policy denies `s3:GetObject` to anonymous/public principals.
- [ ] Enforce Super Admin tenant lifecycle monitoring (`/api/admin/tenants`) and rotate `official` partner API keys on schedule.
- [ ] Keep demonstration accounts disabled or rotated in non-demo production databases.

---

## 5. Remaining Integration Blockers (External Systems & Credentials)

The following external integrations require third-party infrastructure, vendor credentials, or bilateral government/VAC agreements outside this repository before live consular production traffic:

1. **PostgreSQL & Redis Driver Cutover**:
   - **Current State**: `/prisma/schema.prisma` and `/docker-compose.yml` define the production PostgreSQL 16 + Redis 7 topology, while the active server runtime (`server/db.ts`, `server/routes/*`, `server/services/*`) executes synchronously against `node:sqlite` and relational `processing_jobs` / `notification_jobs` tables.
   - **Blocker**: Deploying horizontally scaled multi-replica API + worker containers requires wiring Prisma Client / `pg` + `bullmq` against `DATABASE_URL` and `REDIS_URL`.
2. **S3-Compatible Object Storage SDK Integration**:
   - **Current State**: `server/services/storage.ts` validates magic bytes and EICAR malware signatures and serves private local objects via HMAC-signed `/api/storage/signed/*` URLs.
   - **Blocker**: Multi-node persistence requires integrating `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` when `S3_ENDPOINT` / `S3_BUCKET` are set.
3. **Live Gemini API Key & Scanned-Image OCR Microservice**:
   - **Current State**: `server/services/aiProvider.ts` and `server/services/ocr.ts` call `@google/genai` (only when `EXTERNAL_AI_PROCESSING` consent is active) and safely fall back to deterministic text/regex parsing when `GEMINI_API_KEY` is absent.
   - **Blocker**: Live LLM normalization and scanned-image PDF transcription require supplying a funded `GEMINI_API_KEY` and, for high-volume OCR SLAs, connecting Google Document AI / AWS Textract / Tesseract.
4. **Authorized Official Consular Submission & Status APIs**:
   - **Current State**: `server/services/submissionAdapter.ts` and `server/services/statusAdapter.ts` expose strictly typed contracts (`OFFICIAL_VISA_API_*`, `OFFICIAL_STATUS_API_*`), reject spoofed manual `OFFICIAL_API` claims (`400`), and default safely to `GUIDED_MANUAL_HANDOFF` + source-attributed manual updates.
   - **Blocker**: Automated filing and live embassy/VAC status feeds require bilateral government or VFS/TLScontact partner contracts and API credentials. Headless browser scraping and CAPTCHA bypass remain permanently prohibited.
5. **Production Email / SMS Gateways & ClamAV**:
   - **Current State**: Notification workers enforce consent and exponential retry backoff and log deliveries or call `NOTIFICATION_WEBHOOK_URL`; malware checks inspect magic bytes + EICAR test signatures.
   - **Blocker**: Production requires connecting an SMTP/SendGrid + Twilio/SNS transport and an external ClamAV/ICAP virus scanning daemon plus an accredited KYC passport verification provider (`external_identity_status: NOT_CONNECTED`).
6. **Live Consular Policy Feed & Legal Sign-Off**:
   - **Current State**: The interactive Country Visa Rule Engine & Dynamic Visa Form Builder UI (`RuleFormBuilderView.tsx`, `/api/rules/*`) supports authoring, simulating, versioning, and governing custom tenant/global rules (`DRAFT` -> `IN_REVIEW` -> `PUBLISHED`) without code edits.
   - **Blocker**: Production deployments moving beyond demonstration templates require legal compliance review and verified `officialSourceUrl` citations for each destination jurisdiction.
