import { decryptField } from '../crypto.ts';
import { AppDatabase, newId } from '../db.ts';

export type RuleConditionType =
  | 'ALWAYS'
  | 'HAS_DEPENDENTS'
  | 'STAY_OVER_30_DAYS';

export interface RequirementTemplate {
  requirementCode: string;
  title: string;
  description: string;
  documentType: string;
  isMandatory: boolean;
  conditionNote: string;
  conditionType?: RuleConditionType;
}

function buildBuiltinRequirementsForRoute(params: {
  destinationCountry: string;
  visaCategory: string;
  hasDependents: boolean;
  travelDurationDays?: number;
}): RequirementTemplate[] {
  const base: RequirementTemplate[] = [
    {
      requirementCode: 'PASSPORT_BIO_PAGE',
      title: 'Valid Passport Biographical Page',
      description: 'Clear color scan of passport bio-data page showing full name, number, and expiry date.',
      documentType: 'PASSPORT',
      isMandatory: true,
      conditionNote: 'Demonstration rule: valid passport required for all routes.',
      conditionType: 'ALWAYS',
    },
    {
      requirementCode: 'PASSPORT_PHOTO',
      title: 'Biometric Passport Photograph',
      description: 'Recent front-facing passport-compliant photograph on light background.',
      documentType: 'PASSPORT_PHOTO',
      isMandatory: true,
      conditionNote: 'Required biometric photo.',
      conditionType: 'ALWAYS',
    },
    {
      requirementCode: 'BANK_STATEMENTS',
      title: 'Recent Bank Statements (Last 3 Months)',
      description: 'Financial statements showing account holder name, currency, and closing balance.',
      documentType: 'BANK_STATEMENT',
      isMandatory: true,
      conditionNote: 'Proof of sufficient funds (demonstration requirement).',
      conditionType: 'ALWAYS',
    },
  ];

  if (params.destinationCountry === 'DE' && params.visaCategory === 'TOURIST') {
    base.push(
      {
        requirementCode: 'SCHENGEN_TRAVEL_INSURANCE',
        title: 'Schengen Travel Medical Insurance',
        description: 'Policy certificate showing minimum €30,000 medical & repatriation coverage.',
        documentType: 'TRAVEL_INSURANCE',
        isMandatory: true,
        conditionNote: 'Germany Schengen Demonstration Rule (demo-2026.1).',
        conditionType: 'ALWAYS',
      },
      {
        requirementCode: 'TRAVEL_ITINERARY_LODGING',
        title: 'Flight Itinerary & Hotel Reservation',
        description: 'Round-trip flight itinerary and confirmed accommodation dates.',
        documentType: 'TRAVEL_ITINERARY',
        isMandatory: true,
        conditionNote: 'Schengen short-stay itinerary proof.',
        conditionType: 'ALWAYS',
      },
    );
  } else if (params.visaCategory === 'BUSINESS' || params.visaCategory === 'WORK') {
    base.push(
      {
        requirementCode: 'EMPLOYMENT_LETTER',
        title: 'Employer Verification / Employment Letter',
        description: 'Official company letter confirming position, salary, and travel authorization.',
        documentType: 'EMPLOYMENT_LETTER',
        isMandatory: true,
        conditionNote: 'Required for business and employment routes.',
        conditionType: 'ALWAYS',
      },
      {
        requirementCode: 'INVITATION_LETTER',
        title: 'Host Organization Invitation Letter',
        description: 'Signed invitation detailing host address, dates, and visit purpose.',
        documentType: 'INVITATION_LETTER',
        isMandatory: false,
        conditionNote: 'Required when visiting a host client or office.',
        conditionType: 'ALWAYS',
      },
    );
  } else if (params.visaCategory === 'STUDENT') {
    base.push({
      requirementCode: 'ADMISSION_LETTER',
      title: 'Designated Learning Institution Admission Letter',
      description: 'Official letter of acceptance stating program dates and tuition.',
      documentType: 'ADMISSION_LETTER',
      isMandatory: true,
      conditionNote: 'Required for student visa routes.',
      conditionType: 'ALWAYS',
    });
  }

  if ((params.travelDurationDays ?? 0) > 30) {
    base.push({
      requirementCode: 'LONG_STAY_ACCOMMODATION_PROOF',
      title: 'Extended Stay Accommodation & Return Ties Proof',
      description: 'Lease, university housing, or long-term lodging confirmation for stays over 30 days.',
      documentType: 'TRAVEL_ITINERARY',
      isMandatory: true,
      conditionNote: 'Triggered because intended travel duration exceeds 30 days.',
      conditionType: 'STAY_OVER_30_DAYS',
    });
  }

  if (params.hasDependents) {
    base.push({
      requirementCode: 'FAMILY_RELATIONSHIP_PROOF',
      title: 'Marriage or Birth Certificate (Dependents)',
      description: 'Civil status certificate documenting relationship to accompanying dependents.',
      documentType: 'BIRTH_MARRIAGE_CERT',
      isMandatory: true,
      conditionNote: 'Triggered because dependents are listed in applicant profile.',
      conditionType: 'HAS_DEPENDENTS',
    });
  }

  return base;
}

export function resolvePublishedVisaRoute(
  db: AppDatabase,
  params: {
    destinationCountry: string;
    visaCategory: string;
    organizationId?: string;
    routeId?: string | null;
  },
): Record<string, unknown> | undefined {
  if (params.routeId) {
    const byId = db
      .prepare("SELECT * FROM visa_routes WHERE id = ? AND approval_status = 'PUBLISHED'")
      .get(params.routeId) as Record<string, unknown> | undefined;
    if (byId) return byId;
  }

  if (params.organizationId) {
    const orgSpecific = db
      .prepare(
        `
        SELECT * FROM visa_routes
        WHERE organization_id = ? AND destination_country = ? AND visa_category_code = ? AND approval_status = 'PUBLISHED'
        ORDER BY COALESCE(approved_at, effective_from) DESC
        LIMIT 1
      `,
      )
      .get(params.organizationId, params.destinationCountry, params.visaCategory) as
      | Record<string, unknown>
      | undefined;
    if (orgSpecific) return orgSpecific;
  }

  return db
    .prepare(
      `
      SELECT * FROM visa_routes
      WHERE organization_id IS NULL AND destination_country = ? AND visa_category_code = ? AND approval_status = 'PUBLISHED'
      ORDER BY COALESCE(approved_at, effective_from) DESC
      LIMIT 1
    `,
    )
    .get(params.destinationCountry, params.visaCategory) as Record<string, unknown> | undefined;
}

export function evaluateCountryVisaRuleEngine(
  db: AppDatabase,
  params: {
    destinationCountry: string;
    visaCategory: string;
    organizationId?: string;
    routeId?: string | null;
    hasDependents: boolean;
    travelDurationDays?: number;
  },
): {
  matchedRoute: Record<string, unknown> | null;
  templates: RequirementTemplate[];
  ruleSource: 'CUSTOM_RULE_DEFINITION' | 'BUILTIN_ROUTE_ADAPTER';
} {
  const matchedRoute = resolvePublishedVisaRoute(db, params) || null;
  const rawJson = matchedRoute?.requirements_json ? String(matchedRoute.requirements_json) : null;

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as RequirementTemplate[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const filtered = parsed.filter((req) => {
          const cond = req.conditionType || 'ALWAYS';
          if (cond === 'HAS_DEPENDENTS') return params.hasDependents;
          if (cond === 'STAY_OVER_30_DAYS') return (params.travelDurationDays ?? 0) > 30;
          return true;
        });
        return {
          matchedRoute,
          templates: filtered,
          ruleSource: 'CUSTOM_RULE_DEFINITION',
        };
      }
    } catch {
      // Fallback to builtin rule adapter if malformed
    }
  }

  return {
    matchedRoute,
    templates: buildBuiltinRequirementsForRoute(params),
    ruleSource: 'BUILTIN_ROUTE_ADAPTER',
  };
}

export function syncChecklistForCase(
  db: AppDatabase,
  applicationId: string,
  organizationId: string,
) {
  const appRow = db
    .prepare('SELECT * FROM visa_applications WHERE id = ? AND organization_id = ?')
    .get(applicationId, organizationId) as Record<string, unknown> | undefined;

  if (!appRow) {
    throw new Error('Visa application not found');
  }

  const profileRow = db
    .prepare('SELECT dependents_json FROM applicant_profiles WHERE user_id = ? AND organization_id = ?')
    .get(String(appRow.applicant_user_id), organizationId) as
    | { dependents_json: string }
    | undefined;

  const dependents = profileRow ? JSON.parse(profileRow.dependents_json || '[]') : [];

  // Derive stay duration from saved dynamic form arrivalDate/departureDate if available
  let travelDurationDays: number | undefined;
  const formRow = db
    .prepare('SELECT answers_json FROM application_forms WHERE application_id = ? AND organization_id = ?')
    .get(applicationId, organizationId) as { answers_json?: string } | undefined;
  if (formRow?.answers_json) {
    try {
      const ans = JSON.parse(formRow.answers_json) as Record<string, unknown>;
      if (typeof ans.arrivalDate === 'string' && typeof ans.departureDate === 'string') {
        const diffMs = Date.parse(ans.departureDate) - Date.parse(ans.arrivalDate);
        if (Number.isFinite(diffMs) && diffMs > 0) {
          travelDurationDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }
      }
    } catch {
      // Ignore parse error
    }
  }

  const { templates } = evaluateCountryVisaRuleEngine(db, {
    destinationCountry: String(appRow.destination_country),
    visaCategory: String(appRow.visa_category),
    organizationId,
    routeId: appRow.route_id ? String(appRow.route_id) : null,
    hasDependents: Array.isArray(dependents) && dependents.length > 0,
    travelDurationDays,
  });

  const now = new Date().toISOString();
  const docs = db
    .prepare(
      `
      SELECT requirement_code, document_type, review_status, malware_scan_status
      FROM application_documents
      WHERE application_id = ? AND organization_id = ?
      ORDER BY version DESC, created_at DESC
    `,
    )
    .all(applicationId, organizationId) as Array<Record<string, unknown>>;

  for (const tpl of templates) {
    const matchingDocs = docs.filter(
      (d) =>
        (d.requirement_code === tpl.requirementCode || d.document_type === tpl.documentType) &&
        d.malware_scan_status !== 'QUARANTINED',
    );

    let nextStatus = 'MISSING';
    if (matchingDocs.some((d) => d.review_status === 'VERIFIED')) {
      nextStatus = 'VERIFIED';
    } else if (matchingDocs.some((d) => d.review_status === 'NEEDS_CORRECTION')) {
      nextStatus = 'NEEDS_CORRECTION';
    } else if (matchingDocs.some((d) => d.review_status === 'REJECTED')) {
      nextStatus = 'REJECTED';
    } else if (matchingDocs.length > 0) {
      nextStatus = 'UPLOADED';
    }

    const existing = db
      .prepare('SELECT id FROM document_requirements WHERE application_id = ? AND requirement_code = ?')
      .get(applicationId, tpl.requirementCode) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        'UPDATE document_requirements SET title = ?, description = ?, is_mandatory = ?, condition_note = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(
        tpl.title,
        tpl.description,
        tpl.isMandatory ? 1 : 0,
        tpl.conditionNote,
        nextStatus,
        now,
        existing.id,
      );
    } else {
      db.prepare(`
        INSERT INTO document_requirements (
          id, application_id, organization_id, requirement_code, title, description,
          document_type, is_mandatory, condition_note, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId('req'),
        applicationId,
        organizationId,
        tpl.requirementCode,
        tpl.title,
        tpl.description,
        tpl.documentType,
        tpl.isMandatory ? 1 : 0,
        tpl.conditionNote,
        nextStatus,
        now,
        now,
      );
    }
  }

  return db
    .prepare(
      'SELECT * FROM document_requirements WHERE application_id = ? AND organization_id = ? ORDER BY is_mandatory DESC, title ASC',
    )
    .all(applicationId, organizationId);
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function runCaseVerification(
  db: AppDatabase,
  applicationId: string,
  organizationId: string,
) {
  const appRow = db
    .prepare('SELECT * FROM visa_applications WHERE id = ? AND organization_id = ?')
    .get(applicationId, organizationId) as Record<string, unknown> | undefined;

  if (!appRow) {
    throw new Error('Visa application not found');
  }

  const requirements = syncChecklistForCase(db, applicationId, organizationId) as Array<
    Record<string, unknown>
  >;

  const documents = db
    .prepare(
      `
      SELECT d.*, e.detected_document_type, e.extracted_json, e.corrected_json, e.confidence_score, e.is_confirmed
      FROM application_documents d
      LEFT JOIN document_extractions e ON e.document_id = d.id
      WHERE d.application_id = ? AND d.organization_id = ?
      ORDER BY d.created_at DESC
    `,
    )
    .all(applicationId, organizationId) as Array<Record<string, unknown>>;

  const profile = db
    .prepare(
      `
      SELECT p.*, pr.passport_number_encrypted, pr.expiry_date AS profile_passport_expiry
      FROM applicant_profiles p
      LEFT JOIN passport_records pr ON pr.applicant_profile_id = p.id
      WHERE p.user_id = ? AND p.organization_id = ?
    `,
    )
    .get(String(appRow.applicant_user_id), organizationId) as Record<string, unknown> | undefined;

  let profilePassportNumber: string | null = null;
  if (profile?.passport_number_encrypted) {
    try {
      profilePassportNumber = decryptField(String(profile.passport_number_encrypted));
    } catch {
      profilePassportNumber = null;
    }
  }

  const now = new Date().toISOString();
  const todayStr = now.slice(0, 10);

  // Upsert DocumentVerification container
  const existingVerif = db
    .prepare('SELECT id FROM document_verifications WHERE application_id = ?')
    .get(applicationId) as { id: string } | undefined;

  const verificationId = existingVerif ? existingVerif.id : newId('ver');
  if (!existingVerif) {
    db.prepare(`
      INSERT INTO document_verifications (
        id, application_id, organization_id, formatting_status, extraction_status,
        consistency_status, external_identity_status, manual_officer_status, created_at, updated_at
      ) VALUES (?, ?, ?, 'PENDING', 'PENDING', 'PENDING', 'NOT_CONNECTED', 'PENDING_REVIEW', ?, ?)
    `).run(verificationId, applicationId, organizationId, now, now);
  }

  // Clear previously auto-generated OPEN issues before re-evaluating (preserve OVERRIDDEN/RESOLVED history if needed, or replace OPEN)
  db.prepare(
    "DELETE FROM verification_issues WHERE verification_id = ? AND status = 'OPEN'",
  ).run(verificationId);

  const issues: Array<{
    sourceDocumentId?: string | null;
    issueType: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    verificationLayer:
      | 'FORMATTING_VALIDATION'
      | 'FIELD_EXTRACTION'
      | 'CROSS_DOCUMENT_CONSISTENCY'
      | 'EXTERNAL_IDENTITY_VERIFICATION'
      | 'MANUAL_OFFICER_REVIEW';
    evidence: string;
    explanation: string;
    suggestedCorrection: string;
  }> = [];

  // 1. Missing mandatory documents
  for (const reqItem of requirements) {
    if (Boolean(reqItem.is_mandatory) && reqItem.status === 'MISSING') {
      issues.push({
        issueType: 'MISSING_MANDATORY_DOCUMENT',
        severity: 'CRITICAL',
        verificationLayer: 'FORMATTING_VALIDATION',
        evidence: `Requirement ${reqItem.requirement_code} (${reqItem.title}) has status MISSING`,
        explanation: `Mandatory document "${reqItem.title}" has not been uploaded for this route.`,
        suggestedCorrection: `Upload a clear PDF, JPG, PNG, or DOCX for "${reqItem.title}".`,
      });
    }
  }

  // 2. Duplicate SHA-256 checksum detection
  const seenChecksums = new Map<string, Record<string, unknown>>();
  for (const doc of documents) {
    const sum = String(doc.sha256_checksum);
    const prev = seenChecksums.get(sum);
    if (prev) {
      issues.push({
        sourceDocumentId: String(doc.id),
        issueType: 'DUPLICATE_DOCUMENT',
        severity: 'WARNING',
        verificationLayer: 'FORMATTING_VALIDATION',
        evidence: `SHA-256 ${sum.slice(0, 12)} matches "${prev.original_filename}"`,
        explanation: `File "${doc.original_filename}" is an identical binary duplicate of "${prev.original_filename}".`,
        suggestedCorrection: 'Remove duplicate upload or upload the intended distinct supporting document.',
      });
    } else {
      seenChecksums.set(sum, doc);
    }
  }

  // 3. Per-document extraction, readability, expiry, and cross-document collection
  const extractedNames: Array<{ docId: string; filename: string; value: string }> = [];
  const extractedPassports: Array<{ docId: string; filename: string; value: string }> = [];
  const extractedDobs: Array<{ docId: string; filename: string; value: string }> = [];

  let formattingOk = true;
  let extractionOk = documents.length > 0;

  for (const doc of documents) {
    if (doc.malware_scan_status === 'QUARANTINED') {
      formattingOk = false;
      issues.push({
        sourceDocumentId: String(doc.id),
        issueType: 'MALWARE_QUARANTINE',
        severity: 'CRITICAL',
        verificationLayer: 'FORMATTING_VALIDATION',
        evidence: `Malware scan status: QUARANTINED (${doc.original_filename})`,
        explanation: 'Uploaded file was flagged by security scanning and quarantined.',
        suggestedCorrection: 'Delete quarantined file and upload a clean verified document.',
      });
      continue;
    }

    const effectiveJsonRaw = doc.corrected_json || doc.extracted_json;
    if (!effectiveJsonRaw) {
      extractionOk = false;
      issues.push({
        sourceDocumentId: String(doc.id),
        issueType: 'EXTRACTION_PENDING',
        severity: 'WARNING',
        verificationLayer: 'FIELD_EXTRACTION',
        evidence: `No OCR extraction record found for ${doc.original_filename}`,
        explanation: 'Document has not completed OCR field extraction yet.',
        suggestedCorrection: 'Run extraction or enter structured fields manually.',
      });
      continue;
    }

    const parsed = JSON.parse(String(effectiveJsonRaw)) as {
      fields?: Record<string, string>;
      unreadableOrIncomplete?: boolean;
      missingPagesDetected?: boolean;
    };
    const fields = parsed.fields || {};
    const conf = Number(doc.confidence_score ?? 0);

    if (parsed.unreadableOrIncomplete || conf < 0.65) {
      extractionOk = false;
      issues.push({
        sourceDocumentId: String(doc.id),
        issueType: 'LOW_READABILITY_OR_INCOMPLETE',
        severity: 'WARNING',
        verificationLayer: 'FIELD_EXTRACTION',
        evidence: `Confidence ${(conf * 100).toFixed(0)}% on ${doc.original_filename}`,
        explanation: 'OCR detected low readability, sparse text, or potentially illegible regions.',
        suggestedCorrection: 'Upload a higher-resolution scan or manually confirm all extracted fields.',
      });
    }

    if (parsed.missingPagesDetected) {
      issues.push({
        sourceDocumentId: String(doc.id),
        issueType: 'MISSING_PAGES_SUSPECTED',
        severity: 'WARNING',
        verificationLayer: 'FORMATTING_VALIDATION',
        evidence: `Page indicator check flagged incomplete sequence in ${doc.original_filename}`,
        explanation: 'Document text suggests a multi-page file may be missing pages.',
        suggestedCorrection: 'Verify all pages are included in a single combined PDF.',
      });
    }

    // Expiry check against today & intended travel date
    const docExpiry = (doc.expiry_date as string | null) || fields.expiryDate || null;
    if (docExpiry) {
      if (docExpiry <= todayStr) {
        issues.push({
          sourceDocumentId: String(doc.id),
          issueType: 'EXPIRED_DOCUMENT',
          severity: 'CRITICAL',
          verificationLayer: 'FIELD_EXTRACTION',
          evidence: `Document expiry date ${docExpiry} <= ${todayStr}`,
          explanation: `Document "${doc.original_filename}" expired on ${docExpiry}.`,
          suggestedCorrection: 'Upload a renewed, valid document before case submission.',
        });
      } else if (
        doc.document_type === 'PASSPORT' &&
        appRow.intended_travel_date &&
        String(appRow.destination_country) === 'DE'
      ) {
        const travelDate = new Date(`${String(appRow.intended_travel_date)}T00:00:00Z`);
        const expiryDt = new Date(`${docExpiry}T00:00:00Z`);
        const minBufferMs = 90 * 24 * 60 * 60 * 1000;
        if (expiryDt.getTime() - travelDate.getTime() < minBufferMs) {
          issues.push({
            sourceDocumentId: String(doc.id),
            issueType: 'PASSPORT_VALIDITY_RULE_WARNING',
            severity: 'CRITICAL',
            verificationLayer: 'CROSS_DOCUMENT_CONSISTENCY',
            evidence: `Passport expires ${docExpiry}; travel date is ${appRow.intended_travel_date} (<90 days buffer)`,
            explanation:
              'Demonstration Schengen route rule requires passport validity at least 3 months beyond intended stay.',
            suggestedCorrection: 'Renew passport or adjust intended travel dates.',
          });
        }
      }
    }

    const nameCandidate = fields.fullName || fields.accountHolderName;
    if (nameCandidate) {
      extractedNames.push({
        docId: String(doc.id),
        filename: String(doc.original_filename),
        value: nameCandidate,
      });
    }
    if (fields.passportNumber) {
      extractedPassports.push({
        docId: String(doc.id),
        filename: String(doc.original_filename),
        value: fields.passportNumber,
      });
    }
    if (fields.dateOfBirth) {
      extractedDobs.push({
        docId: String(doc.id),
        filename: String(doc.original_filename),
        value: fields.dateOfBirth,
      });
    }
  }

  // 4. Cross-document & profile consistency checks
  if (profile?.full_legal_name) {
    const expectedName = normalizeText(profile.full_legal_name);
    for (const item of extractedNames) {
      if (normalizeText(item.value) !== expectedName) {
        issues.push({
          sourceDocumentId: item.docId,
          issueType: 'CROSS_DOCUMENT_NAME_MISMATCH',
          severity: 'CRITICAL',
          verificationLayer: 'CROSS_DOCUMENT_CONSISTENCY',
          evidence: `Profile name "${profile.full_legal_name}" vs document "${item.value}" (${item.filename})`,
          explanation: `Name extracted from "${item.filename}" does not match applicant legal name "${profile.full_legal_name}".`,
          suggestedCorrection:
            'Confirm whether this reflects a typo in OCR, a maiden/middle name difference, or an incorrect document.',
        });
      }
    }
  }

  if (profilePassportNumber) {
    const expectedPassport = normalizeText(profilePassportNumber).replace(/\s+/g, '');
    for (const item of extractedPassports) {
      if (normalizeText(item.value).replace(/\s+/g, '') !== expectedPassport) {
        issues.push({
          sourceDocumentId: item.docId,
          issueType: 'CROSS_DOCUMENT_PASSPORT_MISMATCH',
          severity: 'CRITICAL',
          verificationLayer: 'CROSS_DOCUMENT_CONSISTENCY',
          evidence: `Encrypted profile passport ends with ${profilePassportNumber.slice(-4)} vs extracted "${item.value}" (${item.filename})`,
          explanation: `Passport number in "${item.filename}" does not match the applicant's stored passport record.`,
          suggestedCorrection: 'Verify passport number in both the applicant profile and uploaded scan.',
        });
      }
    }
  }

  if (profile?.date_of_birth) {
    for (const item of extractedDobs) {
      if (item.value !== String(profile.date_of_birth)) {
        issues.push({
          sourceDocumentId: item.docId,
          issueType: 'CROSS_DOCUMENT_DOB_MISMATCH',
          severity: 'CRITICAL',
          verificationLayer: 'CROSS_DOCUMENT_CONSISTENCY',
          evidence: `Profile DOB ${profile.date_of_birth} vs document ${item.value} (${item.filename})`,
          explanation: `Date of birth in "${item.filename}" conflicts with applicant profile DOB.`,
          suggestedCorrection: 'Correct OCR extraction or update applicant profile if entered incorrectly.',
        });
      }
    }
  }

  // Persist detected issues
  const insertIssue = db.prepare(`
    INSERT INTO verification_issues (
      id, verification_id, application_id, organization_id, source_document_id,
      issue_type, severity, verification_layer, evidence, explanation, suggested_correction,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
  `);

  for (const iss of issues) {
    insertIssue.run(
      newId('iss'),
      verificationId,
      applicationId,
      organizationId,
      iss.sourceDocumentId || null,
      iss.issueType,
      iss.severity,
      iss.verificationLayer,
      iss.evidence,
      iss.explanation,
      iss.suggestedCorrection,
      now,
      now,
    );
  }

  const hasCriticalConsistency = issues.some(
    (i) => i.verificationLayer === 'CROSS_DOCUMENT_CONSISTENCY' && i.severity === 'CRITICAL',
  );
  const hasAnyWarningConsistency = issues.some(
    (i) => i.verificationLayer === 'CROSS_DOCUMENT_CONSISTENCY',
  );
  const allDocsVerifiedByOfficer =
    documents.length > 0 &&
    documents.every((d) => d.review_status === 'VERIFIED') &&
    requirements.every((r) => !r.is_mandatory || r.status === 'VERIFIED');

  const formattingStatus = !formattingOk
    ? 'FAILED'
    : issues.some((i) => i.verificationLayer === 'FORMATTING_VALIDATION')
      ? 'WARNINGS'
      : 'PASSED';

  const extractionStatus = documents.length === 0
    ? 'PENDING'
    : extractionOk
      ? 'PASSED'
      : 'NEEDS_REVIEW';

  const consistencyStatus = documents.length === 0
    ? 'PENDING'
    : hasCriticalConsistency
      ? 'FAILED'
      : hasAnyWarningConsistency
        ? 'WARNINGS'
        : 'PASSED';

  const manualOfficerStatus = allDocsVerifiedByOfficer
    ? 'APPROVED'
    : documents.some((d) => d.review_status === 'REJECTED' || d.review_status === 'NEEDS_CORRECTION')
      ? 'CORRECTION_REQUESTED'
      : 'PENDING_REVIEW';

  db.prepare(`
    UPDATE document_verifications
    SET formatting_status = ?, extraction_status = ?, consistency_status = ?,
        external_identity_status = 'NOT_CONNECTED', manual_officer_status = ?,
        summary_note = ?, verified_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    formattingStatus,
    extractionStatus,
    consistencyStatus,
    manualOfficerStatus,
    'Automated checks evaluate formatting, extraction completeness, and cross-document alignment only. Manual officer review is required; AI cannot certify document authenticity.',
    now,
    now,
    verificationId,
  );

  const verification = db
    .prepare('SELECT * FROM document_verifications WHERE id = ?')
    .get(verificationId);
  const savedIssues = db
    .prepare(
      `
      SELECT vi.*, d.original_filename AS source_filename
      FROM verification_issues vi
      LEFT JOIN application_documents d ON d.id = vi.source_document_id
      WHERE vi.verification_id = ?
      ORDER BY CASE vi.severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END, vi.created_at DESC
    `,
    )
    .all(verificationId);

  return { verification, issues: savedIssues, requirements };
}
