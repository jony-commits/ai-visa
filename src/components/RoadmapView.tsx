import React from 'react';

const PHASES = [
  {
    phase: 'Phase 1',
    title: 'Foundation, Auth, Multi-Tenancy, Profiles & Core Case Management',
    status: 'Implemented & Verified',
    items: [
      'Scrypt password hashing, SHA-256 verification/reset tokens, RFC 6238 TOTP MFA',
      'Multi-tenant agencies with strict row-level organization isolation & RBAC',
      'Applicant onboarding, dependents, AES-256-GCM encrypted passport records, GDPR JSON export',
      'Visa case creation, consultant assignment, state-machine transitions, tasks, and notes',
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Dynamic Checklists, Secure Uploads & Versioned Rules',
    status: 'Checklists & Storage Implemented (Rule Builder Pending)',
    items: [
      'Dynamic route/dependent document checklists (syncChecklistForCase)',
      'Private S3-compatible & HMAC-signed upload/download URLs, magic-byte validation & malware scan hook',
      'Staff-verified rule builder (DRAFT -> IN_REVIEW -> PUBLISHED) — Pending',
    ],
  },
  {
    phase: 'Phase 3',
    title: 'OCR, AI Document Extraction & Cross-Document Verification',
    status: 'Implemented & Verified',
    items: [
      'Configurable OCR + consent-gated @google/genai server-side extraction & BullMQ-compatible job pipeline',
      'Deterministic cross-document consistency, expiration/Schengen checks separating extraction from authenticity',
      'Manual field correction workbench, confidence indicators, and Verification Officer review queue',
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Dynamic Visa Forms, AI Prefill & Submission Handoff',
    status: 'Implemented & Verified',
    items: [
      'Versioned country-specific JSON Schema multi-step forms with conditional logic, auto-save & revision history',
      'Verified applicant data prefill + consent-gated AI draft suggestions clearly marked for review and applicant approval',
      'Submission adapter supporting authorized official APIs or guided manual handoffs (never automates restricted portals)',
    ],
  },
  {
    phase: 'Phase 5',
    title: 'Workflow Automation, Source-Verified Tracking & Notifications',
    status: 'Implemented & Verified',
    items: [
      'Configurable organization workflow stages, SLAs, consultant assignments, deadlines & unified timeline',
      'Appointment tracking, authorized official API status adapter contracts & source-attributed manual updates with verification timestamps',
      'BullMQ-compatible notification workers with exponential retry backoff, consent checks & customizable Email/SMS templates',
    ],
  },
  {
    phase: 'Phase 6',
    title: 'Operational Analytics, Super Admin Console & Hardening',
    status: 'Planned',
    items: [
      'Agency turnaround & bottleneck analytics (non-predictive)',
      'Playwright E2E tests & production security audit',
    ],
  },
];

export const RoadmapView: React.FC = () => {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-bold">Implementation Roadmap & System Scope</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Transparent phased delivery tracker synced with docs/IMPLEMENTATION_PLAN.md. Unimplemented external integrations are never simulated as live policy or official government tracking.
        </p>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
        {PHASES.map((p) => (
          <div key={p.phase} className="p-5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-display text-sm font-semibold">
                {p.phase}: {p.title}
              </div>
              <span
                className={`text-xs font-medium ${
                  p.status.startsWith('Implemented')
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {p.status}
              </span>
            </div>
            <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
              {p.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};
