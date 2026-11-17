import { AppDatabase, newId } from '../db.ts';
import { getFormDetailPayload } from './formEngine.ts';
import { evaluateFieldCondition, VisaFormJsonSchema } from './formSchemas.ts';

export type SupportedSubmissionMode =
  | 'AUTHORIZED_OFFICIAL_API'
  | 'GUIDED_MANUAL_HANDOFF';

export interface SubmissionCapabilityReport {
  adapterId: string;
  mode: SupportedSubmissionMode;
  displayName: string;
  available: boolean;
  requiresOfficialPartnership: boolean;
  automationPolicy: string;
  reason: string;
  targetPortalUrl: string | null;
}

export interface SubmissionContext {
  db: AppDatabase;
  applicationId: string;
  organizationId: string;
  actorUserId: string;
  referenceNumber: string;
  destinationCountry: string;
  visaCategory: string;
  officialSourceUrl: string | null;
  schema: VisaFormJsonSchema;
  answers: Record<string, unknown>;
  sourceAttribution: Record<string, string>;
  applicantApprovedAt: string;
  revisionNumber: number;
}

export interface SubmissionExecutionResult {
  adapterId: string;
  mode: SupportedSubmissionMode;
  status: 'SUBMITTED_VIA_OFFICIAL_API' | 'HANDOFF_PACKAGE_READY' | 'UNAVAILABLE';
  externalConfirmationRef: string | null;
  governmentStatusSource: 'OFFICIAL_API' | 'CONSULTANT_MANUAL_UPDATE' | 'UNAVAILABLE';
  handoffPackage: Record<string, unknown>;
}

export interface SubmissionAdapter {
  adapterId: string;
  mode: SupportedSubmissionMode;
  supportsRoute(destinationCountry: string, visaCategory: string): boolean;
  inspectCapabilities(ctx: {
    destinationCountry: string;
    visaCategory: string;
    officialSourceUrl: string | null;
  }): SubmissionCapabilityReport;
  execute(ctx: SubmissionContext): Promise<SubmissionExecutionResult>;
}

const PROHIBITED_MODES = new Set([
  'HEADLESS_BROWSER_AUTOMATION',
  'PORTAL_SCRAPING',
  'CAPTCHA_BYPASS',
  'UNAUTHORIZED_BOT',
]);

export function assertSubmissionModeAllowed(requestedMode: string): void {
  if (PROHIBITED_MODES.has(requestedMode.toUpperCase())) {
    const err = new Error(
      'Policy Violation: Automated interaction with restricted government portals, bot-challenge bypassing, or CAPTCHA solving is strictly prohibited.',
    ) as Error & { statusCode?: number; code?: string };
    err.statusCode = 403;
    err.code = 'FORBIDDEN_PORTAL_AUTOMATION';
    throw err;
  }
}

export class AuthorizedOfficialApiAdapter implements SubmissionAdapter {
  adapterId = 'official-gov-api-v1';
  mode: SupportedSubmissionMode = 'AUTHORIZED_OFFICIAL_API';

  supportsRoute(_destinationCountry: string, _visaCategory: string): boolean {
    return Boolean(
      process.env.OFFICIAL_VISA_API_URL?.trim() &&
        process.env.OFFICIAL_VISA_API_KEY?.trim(),
    );
  }

  inspectCapabilities(ctx: {
    destinationCountry: string;
    visaCategory: string;
    officialSourceUrl: string | null;
  }): SubmissionCapabilityReport {
    const configured = this.supportsRoute(ctx.destinationCountry, ctx.visaCategory);
    return {
      adapterId: this.adapterId,
      mode: this.mode,
      displayName: 'Authorized Official Government API',
      available: configured,
      requiresOfficialPartnership: true,
      automationPolicy:
        'Only transmits to pre-authorized partner/consular endpoints with explicit API credentials.',
      reason: configured
        ? `Authorized endpoint configured for ${ctx.destinationCountry} (${ctx.visaCategory}).`
        : 'No authorized official consular API credentials are configured for this route. Use Guided Manual Handoff instead.',
      targetPortalUrl: ctx.officialSourceUrl,
    };
  }

  async execute(ctx: SubmissionContext): Promise<SubmissionExecutionResult> {
    const endpoint = process.env.OFFICIAL_VISA_API_URL?.trim();
    const apiKey = process.env.OFFICIAL_VISA_API_KEY?.trim();

    if (!endpoint || !apiKey) {
      return {
        adapterId: this.adapterId,
        mode: this.mode,
        status: 'UNAVAILABLE',
        externalConfirmationRef: null,
        governmentStatusSource: 'UNAVAILABLE',
        handoffPackage: {
          available: false,
          reason:
            'Official API integration is not configured. Authorized manual portal filing is required.',
        },
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Idempotency-Key': `${ctx.applicationId}-rev${ctx.revisionNumber}`,
      },
      body: JSON.stringify({
        referenceNumber: ctx.referenceNumber,
        destinationCountry: ctx.destinationCountry,
        visaCategory: ctx.visaCategory,
        schemaKey: ctx.schema.schemaKey,
        schemaVersion: ctx.schema.version,
        applicantApprovedAt: ctx.applicantApprovedAt,
        answers: ctx.answers,
      }),
    });

    if (!res.ok) {
      throw new Error(`Authorized official API returned HTTP ${res.status}`);
    }

    const body = (await res.json().catch(() => ({}))) as { confirmationRef?: string };
    const confirmationRef = body.confirmationRef || `API-${ctx.referenceNumber}`;

    return {
      adapterId: this.adapterId,
      mode: this.mode,
      status: 'SUBMITTED_VIA_OFFICIAL_API',
      externalConfirmationRef: confirmationRef,
      governmentStatusSource: 'OFFICIAL_API',
      handoffPackage: {
        submittedAt: new Date().toISOString(),
        endpointHost: new URL(endpoint).host,
        confirmationRef,
        schemaVersion: ctx.schema.version,
      },
    };
  }
}

export class GuidedManualHandoffAdapter implements SubmissionAdapter {
  adapterId = 'guided-manual-handoff-v1';
  mode: SupportedSubmissionMode = 'GUIDED_MANUAL_HANDOFF';

  supportsRoute(): boolean {
    return true;
  }

  inspectCapabilities(ctx: {
    destinationCountry: string;
    visaCategory: string;
    officialSourceUrl: string | null;
  }): SubmissionCapabilityReport {
    return {
      adapterId: this.adapterId,
      mode: this.mode,
      displayName: 'Guided Manual Portal Handoff',
      available: true,
      requiresOfficialPartnership: false,
      automationPolicy:
        'Prepares operator/applicant copy-ready field blocks and checklists. Never automates restricted portals or bypasses CAPTCHA/MFA challenges.',
      reason:
        'Generates a verified, copy-ready handoff package and step-by-step manual submission checklist.',
      targetPortalUrl: ctx.officialSourceUrl,
    };
  }

  async execute(ctx: SubmissionContext): Promise<SubmissionExecutionResult> {
    const sections = ctx.schema.steps
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((step) => {
        const fields = Object.entries(ctx.schema.properties)
          .filter(
            ([, spec]) =>
              spec.stepId === step.id && evaluateFieldCondition(spec.visibleWhen, ctx.answers),
          )
          .map(([key, spec]) => {
            const raw = ctx.answers[key];
            const displayValue =
              spec.sensitiveMasked && typeof raw === 'string' && raw.length > 4
                ? `••••${raw.slice(-4)} (unlock via encrypted passport view)`
                : raw ?? '';
            return {
              fieldKey: key,
              label: spec.title,
              value: displayValue,
              source: ctx.sourceAttribution[key] || 'APPLICANT_INPUT',
            };
          });
        return {
          stepId: step.id,
          stepTitle: step.title,
          fields,
        };
      });

    const checklistSteps = [
      `1. Open the official destination portal (${ctx.officialSourceUrl || 'verified government application portal'}) manually in a standard browser session.`,
      '2. Complete human identity login, MFA, or CAPTCHA checks directly — Meridian Visa never automates or bypasses security challenges.',
      `3. Copy approved fields from the ${sections.length} structured sections below into the official portal (Form Schema: ${ctx.schema.schemaKey} v${ctx.schema.version}).`,
      '4. Upload the verified supporting PDF package from the Documents tab.',
      '5. After paying official fees and receiving the portal receipt, enter the confirmation reference below to update case tracking honestly.',
    ];

    return {
      adapterId: this.adapterId,
      mode: this.mode,
      status: 'HANDOFF_PACKAGE_READY',
      externalConfirmationRef: null,
      governmentStatusSource: 'UNAVAILABLE',
      handoffPackage: {
        referenceNumber: ctx.referenceNumber,
        destinationCountry: ctx.destinationCountry,
        visaCategory: ctx.visaCategory,
        schemaVersion: ctx.schema.version,
        applicantApprovedAt: ctx.applicantApprovedAt,
        revisionNumber: ctx.revisionNumber,
        officialPortalUrl: ctx.officialSourceUrl,
        automationGuardrail:
          'Restricted external government portals and anti-bot challenges are never automated or bypassed.',
        checklistSteps,
        sections,
      },
    };
  }
}

const REGISTERED_ADAPTERS: SubmissionAdapter[] = [
  new AuthorizedOfficialApiAdapter(),
  new GuidedManualHandoffAdapter(),
];

export function listSubmissionCapabilities(
  db: AppDatabase,
  applicationId: string,
  organizationId: string,
) {
  const appRow = db
    .prepare(
      `
      SELECT a.*, r.official_source_url
      FROM visa_applications a
      LEFT JOIN visa_routes r ON r.id = a.route_id
      WHERE a.id = ? AND a.organization_id = ?
    `,
    )
    .get(applicationId, organizationId) as Record<string, unknown> | undefined;

  if (!appRow) {
    throw new Error('Visa application not found');
  }

  return REGISTERED_ADAPTERS.map((adapter) =>
    adapter.inspectCapabilities({
      destinationCountry: String(appRow.destination_country),
      visaCategory: String(appRow.visa_category),
      officialSourceUrl: appRow.official_source_url ? String(appRow.official_source_url) : null,
    }),
  );
}

export async function createSubmissionHandoff(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    actorUserId: string;
    mode: string;
  },
) {
  assertSubmissionModeAllowed(params.mode);

  const adapter = REGISTERED_ADAPTERS.find((a) => a.mode === params.mode);
  if (!adapter) {
    const err = new Error(
      `Unsupported submission mode "${params.mode}". Allowed modes: AUTHORIZED_OFFICIAL_API, GUIDED_MANUAL_HANDOFF.`,
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const appRow = db
    .prepare(
      `
      SELECT a.*, r.official_source_url
      FROM visa_applications a
      LEFT JOIN visa_routes r ON r.id = a.route_id
      WHERE a.id = ? AND a.organization_id = ?
    `,
    )
    .get(params.applicationId, params.organizationId) as Record<string, unknown> | undefined;

  if (!appRow) {
    throw new Error('Visa application not found');
  }

  const formPayload = getFormDetailPayload(
    db,
    params.applicationId,
    params.organizationId,
    params.actorUserId,
  );

  if (!formPayload.form.isComplete) {
    const err = new Error(
      'Application form has incomplete or invalid required fields. Complete the form before generating a submission handoff.',
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  if (!formPayload.form.applicantApproved || !formPayload.form.applicantApprovedAt) {
    const err = new Error(
      'Applicant approval and signed attestation are required before generating a submission handoff.',
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const execResult = await adapter.execute({
    db,
    applicationId: params.applicationId,
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    referenceNumber: String(appRow.reference_number),
    destinationCountry: String(appRow.destination_country),
    visaCategory: String(appRow.visa_category),
    officialSourceUrl: appRow.official_source_url ? String(appRow.official_source_url) : null,
    schema: formPayload.schema,
    answers: formPayload.form.answers,
    sourceAttribution: formPayload.form.sourceAttribution,
    applicantApprovedAt: formPayload.form.applicantApprovedAt,
    revisionNumber: formPayload.form.revisionNumber,
  });

  if (execResult.status === 'UNAVAILABLE') {
    const err = new Error(
      String(execResult.handoffPackage.reason || 'Official API adapter is unavailable.'),
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const now = new Date().toISOString();
  const handoffId = newId('subh');

  db.prepare(`
    INSERT INTO submission_handoffs (
      id, application_id, organization_id, adapter_id, submission_mode, status,
      handoff_package_json, external_portal_url, external_confirmation_ref,
      submitted_by_user_id, submitted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    handoffId,
    params.applicationId,
    params.organizationId,
    execResult.adapterId,
    execResult.mode,
    execResult.status,
    JSON.stringify(execResult.handoffPackage),
    appRow.official_source_url ? String(appRow.official_source_url) : null,
    execResult.externalConfirmationRef,
    params.actorUserId,
    execResult.status === 'SUBMITTED_VIA_OFFICIAL_API' ? now : null,
    now,
    now,
  );

  if (execResult.status === 'SUBMITTED_VIA_OFFICIAL_API' && execResult.externalConfirmationRef) {
    db.prepare(`
      UPDATE visa_applications
      SET government_status = 'Submitted via Authorized Official API',
          government_status_source = 'OFFICIAL_API',
          government_tracking_ref = ?,
          updated_at = ?
      WHERE id = ?
    `).run(execResult.externalConfirmationRef, now, params.applicationId);
  }

  return {
    handoffId,
    ...execResult,
  };
}
