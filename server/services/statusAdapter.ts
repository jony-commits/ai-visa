import { AppDatabase, newId, writeAuditLog } from '../db.ts';
import { GOVERNMENT_STATUS_SOURCES, GovernmentStatusSource } from '../types.ts';

export interface StatusAdapterContractReport {
  adapterId: string;
  displayName: string;
  sourceType: GovernmentStatusSource;
  connected: boolean;
  available: boolean;
  pollingPolicy: string;
  reason: string;
  targetPortalUrl: string | null;
}

export interface StatusFetchContext {
  applicationId: string;
  organizationId: string;
  referenceNumber: string;
  destinationCountry: string;
  visaCategory: string;
  trackingReference: string | null;
}

export interface StatusFetchResult {
  connected: boolean;
  status: 'SYNCED' | 'UNAVAILABLE' | 'ERROR';
  statusText?: string;
  trackingReference?: string | null;
  verifiedAt?: string;
  rawEvidenceNote?: string;
  reason?: string;
}

export interface OfficialStatusTrackingAdapter {
  adapterId: string;
  displayName: string;
  sourceType: GovernmentStatusSource;
  supportsRoute(destinationCountry: string, visaCategory: string): boolean;
  inspectContract(ctx: {
    destinationCountry: string;
    visaCategory: string;
    officialSourceUrl: string | null;
  }): StatusAdapterContractReport;
  fetchLatestStatus(ctx: StatusFetchContext): Promise<StatusFetchResult>;
}

export class AuthorizedConsularStatusAdapter implements OfficialStatusTrackingAdapter {
  adapterId = 'official-consular-status-api-v1';
  displayName = 'Authorized Consular Status Tracking API';
  sourceType: GovernmentStatusSource = 'OFFICIAL_API';

  supportsRoute(_destinationCountry: string, _visaCategory: string): boolean {
    return Boolean(
      process.env.OFFICIAL_STATUS_API_URL?.trim() &&
        process.env.OFFICIAL_STATUS_API_KEY?.trim(),
    );
  }

  inspectContract(ctx: {
    destinationCountry: string;
    visaCategory: string;
    officialSourceUrl: string | null;
  }): StatusAdapterContractReport {
    const configured = this.supportsRoute(ctx.destinationCountry, ctx.visaCategory);
    return {
      adapterId: this.adapterId,
      displayName: this.displayName,
      sourceType: this.sourceType,
      connected: configured,
      available: configured,
      pollingPolicy:
        'Only syncs against authorized official consular/partner API endpoints. Never scrapes portals, bypasses CAPTCHAs, or fabricates status transitions.',
      reason: configured
        ? `Authorized status endpoint configured for ${ctx.destinationCountry} (${ctx.visaCategory}).`
        : 'No authorized official status API credentials configured (OFFICIAL_STATUS_API_URL / OFFICIAL_STATUS_API_KEY). Record verified manual updates with source attribution instead.',
      targetPortalUrl: ctx.officialSourceUrl,
    };
  }

  async fetchLatestStatus(ctx: StatusFetchContext): Promise<StatusFetchResult> {
    const endpoint = process.env.OFFICIAL_STATUS_API_URL?.trim();
    const apiKey = process.env.OFFICIAL_STATUS_API_KEY?.trim();

    if (!endpoint || !apiKey) {
      return {
        connected: false,
        status: 'UNAVAILABLE',
        reason:
          'Authorized official status API is not configured. Official government status has not been modified.',
      };
    }

    const url = new URL(endpoint);
    url.searchParams.set('referenceNumber', ctx.referenceNumber);
    url.searchParams.set('country', ctx.destinationCountry);
    url.searchParams.set('visaCategory', ctx.visaCategory);
    if (ctx.trackingReference) {
      url.searchParams.set('trackingReference', ctx.trackingReference);
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      return {
        connected: true,
        status: 'ERROR',
        reason: `Authorized official status API responded with HTTP ${res.status}.`,
      };
    }

    const payload = (await res.json().catch(() => null)) as {
      statusText?: string;
      trackingReference?: string;
      verifiedAt?: string;
      evidenceNote?: string;
    } | null;

    if (!payload || !payload.statusText?.trim()) {
      return {
        connected: true,
        status: 'ERROR',
        reason: 'Official status API response did not include a valid statusText field.',
      };
    }

    return {
      connected: true,
      status: 'SYNCED',
      statusText: payload.statusText.trim(),
      trackingReference: payload.trackingReference?.trim() || ctx.trackingReference,
      verifiedAt: payload.verifiedAt?.trim() || new Date().toISOString(),
      rawEvidenceNote:
        payload.evidenceNote?.trim() ||
        `Verified via authorized official status API (${url.host}).`,
    };
  }
}

export class SourceAttributedManualStatusAdapter implements OfficialStatusTrackingAdapter {
  adapterId = 'manual-source-attributed-v1';
  displayName = 'Manual Source-Attributed Consular Status Recorder';
  sourceType: GovernmentStatusSource = 'CONSULTANT_MANUAL_UPDATE';

  supportsRoute(): boolean {
    return true;
  }

  inspectContract(ctx: {
    destinationCountry: string;
    visaCategory: string;
    officialSourceUrl: string | null;
  }): StatusAdapterContractReport {
    return {
      adapterId: this.adapterId,
      displayName: this.displayName,
      sourceType: this.sourceType,
      connected: true,
      available: true,
      pollingPolicy:
        'Requires explicit staff attribution, evidence note, and verification timestamp. Cannot impersonate OFFICIAL_API.',
      reason:
        'Available for recording consultant-verified portal checks, uploaded embassy notices, or authorized partner webhooks.',
      targetPortalUrl: ctx.officialSourceUrl,
    };
  }

  async fetchLatestStatus(): Promise<StatusFetchResult> {
    return {
      connected: true,
      status: 'UNAVAILABLE',
      reason: 'Manual status updates are recorded explicitly via POST /status-events.',
    };
  }
}

const REGISTERED_STATUS_ADAPTERS: OfficialStatusTrackingAdapter[] = [
  new AuthorizedConsularStatusAdapter(),
  new SourceAttributedManualStatusAdapter(),
];

export function listStatusTrackingOverview(
  db: AppDatabase,
  applicationId: string,
  organizationId: string,
) {
  const appRow = db
    .prepare(
      `
      SELECT a.id, a.reference_number, a.destination_country, a.visa_category,
             a.internal_status, a.government_status, a.government_status_source,
             a.government_tracking_ref, a.government_status_verified_at,
             a.target_submission_deadline, a.stage_due_at, a.appointment_at,
             r.official_source_url
      FROM visa_applications a
      LEFT JOIN visa_routes r ON r.id = a.route_id
      WHERE a.id = ? AND a.organization_id = ?
    `,
    )
    .get(applicationId, organizationId) as Record<string, unknown> | undefined;

  if (!appRow) {
    const err = new Error('Visa application not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const adapterContracts = REGISTERED_STATUS_ADAPTERS.map((adapter) =>
    adapter.inspectContract({
      destinationCountry: String(appRow.destination_country),
      visaCategory: String(appRow.visa_category),
      officialSourceUrl: appRow.official_source_url ? String(appRow.official_source_url) : null,
    }),
  );

  const events = db
    .prepare(
      `
      SELECT e.*, u.full_name AS verified_by_name
      FROM status_tracking_events e
      LEFT JOIN users u ON u.id = e.verified_by_user_id
      WHERE e.application_id = ? AND e.organization_id = ?
      ORDER BY e.verified_at DESC, e.created_at DESC
    `,
    )
    .all(applicationId, organizationId);

  return {
    applicationId: String(appRow.id),
    referenceNumber: String(appRow.reference_number),
    internalStatus: String(appRow.internal_status),
    governmentStatus: String(appRow.government_status),
    governmentStatusSource: String(appRow.government_status_source),
    governmentTrackingRef: appRow.government_tracking_ref
      ? String(appRow.government_tracking_ref)
      : null,
    governmentStatusVerifiedAt: appRow.government_status_verified_at
      ? String(appRow.government_status_verified_at)
      : null,
    targetSubmissionDeadline: appRow.target_submission_deadline
      ? String(appRow.target_submission_deadline)
      : null,
    stageDueAt: appRow.stage_due_at ? String(appRow.stage_due_at) : null,
    appointmentAt: appRow.appointment_at ? String(appRow.appointment_at) : null,
    adapterContracts,
    events,
  };
}

export function recordManualVerifiedStatusEvent(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    actorUserId: string;
    statusText: string;
    sourceType: GovernmentStatusSource;
    trackingReference?: string | null;
    rawEvidenceNote?: string | null;
    verifiedAt?: string | null;
    ipAddress?: string | null;
  },
) {
  if (
    !params.statusText?.trim() ||
    !params.sourceType ||
    !GOVERNMENT_STATUS_SOURCES.includes(params.sourceType)
  ) {
    const err = new Error(
      'Valid statusText and recognized sourceType are required.',
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  if (params.sourceType === 'OFFICIAL_API') {
    const err = new Error(
      'OFFICIAL_API source can only be written by the authorized government API sync adapter, never by manual entry.',
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  if (params.sourceType === 'UNAVAILABLE') {
    const err = new Error(
      'Select an explicit verified source attribution (e.g. CONSULTANT_MANUAL_UPDATE, APPLICANT_UPLOADED_NOTICE).',
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const verifiedAt = params.verifiedAt?.trim() || now;
  const eventId = newId('ste');
  const trimmedStatus = params.statusText.trim();
  const trimmedRef = params.trackingReference?.trim() || null;

  db.prepare(`
    UPDATE visa_applications
    SET government_status = ?,
        government_status_source = ?,
        government_tracking_ref = COALESCE(?, government_tracking_ref),
        government_status_verified_at = ?,
        updated_at = ?
    WHERE id = ? AND organization_id = ?
  `).run(
    trimmedStatus,
    params.sourceType,
    trimmedRef,
    verifiedAt,
    now,
    params.applicationId,
    params.organizationId,
  );

  db.prepare(`
    INSERT INTO status_tracking_events (
      id, application_id, organization_id, status_category, status_text,
      source_type, tracking_reference, adapter_id, raw_evidence_note,
      verified_by_user_id, verified_at, created_at
    ) VALUES (?, ?, ?, 'GOVERNMENT_EXTERNAL', ?, ?, ?, 'manual-source-attributed-v1', ?, ?, ?, ?)
  `).run(
    eventId,
    params.applicationId,
    params.organizationId,
    trimmedStatus,
    params.sourceType,
    trimmedRef,
    params.rawEvidenceNote?.trim() || null,
    params.actorUserId,
    verifiedAt,
    now,
  );

  writeAuditLog(db, {
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'GOVERNMENT_STATUS_RECORDED',
    resourceType: 'VisaApplication',
    resourceId: params.applicationId,
    metadata: {
      eventId,
      governmentStatus: trimmedStatus,
      governmentStatusSource: params.sourceType,
      governmentTrackingRef: trimmedRef,
      verifiedAt,
    },
    ipAddress: params.ipAddress || null,
  });

  return {
    eventId,
    statusText: trimmedStatus,
    sourceType: params.sourceType,
    trackingReference: trimmedRef,
    verifiedAt,
  };
}

export async function syncStatusFromAuthorizedApi(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    actorUserId: string;
    ipAddress?: string | null;
  },
) {
  const appRow = db
    .prepare(
      `
      SELECT id, organization_id, reference_number, destination_country,
             visa_category, government_tracking_ref
      FROM visa_applications
      WHERE id = ? AND organization_id = ?
    `,
    )
    .get(params.applicationId, params.organizationId) as Record<string, unknown> | undefined;

  if (!appRow) {
    const err = new Error('Visa application not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const adapter = new AuthorizedConsularStatusAdapter();
  const result = await adapter.fetchLatestStatus({
    applicationId: String(appRow.id),
    organizationId: String(appRow.organization_id),
    referenceNumber: String(appRow.reference_number),
    destinationCountry: String(appRow.destination_country),
    visaCategory: String(appRow.visa_category),
    trackingReference: appRow.government_tracking_ref
      ? String(appRow.government_tracking_ref)
      : null,
  });

  if (result.status !== 'SYNCED' || !result.statusText) {
    return {
      synced: false,
      connected: result.connected,
      status: result.status,
      reason: result.reason || 'Official API did not return a status update.',
    };
  }

  const now = new Date().toISOString();
  const verifiedAt = result.verifiedAt || now;
  const eventId = newId('ste');

  db.prepare(`
    UPDATE visa_applications
    SET government_status = ?,
        government_status_source = 'OFFICIAL_API',
        government_tracking_ref = COALESCE(?, government_tracking_ref),
        government_status_verified_at = ?,
        updated_at = ?
    WHERE id = ? AND organization_id = ?
  `).run(
    result.statusText,
    result.trackingReference || null,
    verifiedAt,
    now,
    params.applicationId,
    params.organizationId,
  );

  db.prepare(`
    INSERT INTO status_tracking_events (
      id, application_id, organization_id, status_category, status_text,
      source_type, tracking_reference, adapter_id, raw_evidence_note,
      verified_by_user_id, verified_at, created_at
    ) VALUES (?, ?, ?, 'GOVERNMENT_EXTERNAL', ?, 'OFFICIAL_API', ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    params.applicationId,
    params.organizationId,
    result.statusText,
    result.trackingReference || null,
    adapter.adapterId,
    result.rawEvidenceNote || null,
    params.actorUserId,
    verifiedAt,
    now,
  );

  writeAuditLog(db, {
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'OFFICIAL_STATUS_SYNCED',
    resourceType: 'VisaApplication',
    resourceId: params.applicationId,
    metadata: {
      eventId,
      adapterId: adapter.adapterId,
      statusText: result.statusText,
      trackingReference: result.trackingReference,
      verifiedAt,
    },
    ipAddress: params.ipAddress || null,
  });

  return {
    synced: true,
    connected: true,
    status: 'SYNCED' as const,
    eventId,
    statusText: result.statusText,
    sourceType: 'OFFICIAL_API' as const,
    trackingReference: result.trackingReference || null,
    verifiedAt,
  };
}
