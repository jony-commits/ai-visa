import { Type } from '@google/genai';
import { decryptField } from '../crypto.ts';
import { AppDatabase, newId } from '../db.ts';
import { AI_MODEL_DOCUMENT, getGeminiClient, hasLiveGeminiKey } from './aiProvider.ts';
import {
  resolveFormSchemaForCase,
  validateFormAgainstSchema,
  VisaFormJsonSchema,
} from './formSchemas.ts';

export type AnswerSourceType =
  | 'VERIFIED_PROFILE'
  | 'VERIFIED_PASSPORT_RECORD'
  | 'CONFIRMED_EXTRACTION'
  | 'APPLICANT_INPUT'
  | 'STAFF_INPUT'
  | 'AI_SUGGESTION_ACCEPTED';

export interface AiFieldSuggestion {
  fieldKey: string;
  suggestedValue: string;
  rationale: string;
  confidence: number;
  status: 'PENDING_REVIEW' | 'ACCEPTED' | 'DISMISSED';
  provider: string;
  model: string;
  reviewRequired: true;
  generatedAt: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
}

export const AI_SUGGESTION_PROMPT_VERSION = 'form-suggest-v1.0';

export function ensureApplicationForm(
  db: AppDatabase,
  applicationId: string,
  organizationId: string,
  actorUserId?: string,
) {
  const appRow = db
    .prepare('SELECT * FROM visa_applications WHERE id = ? AND organization_id = ?')
    .get(applicationId, organizationId) as Record<string, unknown> | undefined;

  if (!appRow) {
    throw new Error('Visa application not found');
  }

  const { row: schemaRow, schema } = resolveFormSchemaForCase(
    db,
    String(appRow.destination_country),
    String(appRow.visa_category),
  );

  let formRow = db
    .prepare('SELECT * FROM application_forms WHERE application_id = ? AND organization_id = ?')
    .get(applicationId, organizationId) as Record<string, unknown> | undefined;

  if (!formRow) {
    const now = new Date().toISOString();
    const formId = newId('frm');
    const validation = validateFormAgainstSchema(schema, {}, false);

    db.prepare(`
      INSERT INTO application_forms (
        id, application_id, organization_id, form_schema_id, schema_version,
        current_step, answers_json, source_attribution_json, ai_suggestions_json,
        validation_errors_json, is_complete, applicant_approved, revision_number,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, '{}', '{}', '{}', ?, 0, 0, 1, ?, ?)
    `).run(
      formId,
      applicationId,
      organizationId,
      String(schemaRow.id),
      String(schemaRow.version),
      JSON.stringify(validation.errors),
      now,
      now,
    );

    db.prepare(`
      INSERT INTO application_form_revisions (
        id, application_form_id, application_id, organization_id, revision_number,
        answers_json, source_attribution_json, changed_by_user_id, change_reason, created_at
      ) VALUES (?, ?, ?, ?, 1, '{}', '{}', ?, 'Form initialized from schema', ?)
    `).run(
      newId('frev'),
      formId,
      applicationId,
      organizationId,
      actorUserId || String(appRow.applicant_user_id),
      now,
    );

    formRow = db
      .prepare('SELECT * FROM application_forms WHERE id = ?')
      .get(formId) as Record<string, unknown>;
  }

  return { appRow, schemaRow, schema, formRow };
}

export function getFormDetailPayload(
  db: AppDatabase,
  applicationId: string,
  organizationId: string,
  actorUserId?: string,
) {
  const { appRow, schemaRow, schema, formRow } = ensureApplicationForm(
    db,
    applicationId,
    organizationId,
    actorUserId,
  );

  const answers = JSON.parse(String(formRow.answers_json || '{}')) as Record<string, unknown>;
  const sourceAttribution = JSON.parse(
    String(formRow.source_attribution_json || '{}'),
  ) as Record<string, AnswerSourceType>;
  const aiSuggestions = JSON.parse(
    String(formRow.ai_suggestions_json || '{}'),
  ) as Record<string, AiFieldSuggestion>;

  const completenessCheck = validateFormAgainstSchema(schema, answers, true);
  const revisions = db
    .prepare(
      `
      SELECT r.id, r.revision_number, r.change_reason, r.created_at, u.full_name AS changed_by_name
      FROM application_form_revisions r
      JOIN users u ON u.id = r.changed_by_user_id
      WHERE r.application_form_id = ?
      ORDER BY r.revision_number DESC LIMIT 20
    `,
    )
    .all(String(formRow.id));

  return {
    schema,
    schemaRecordId: String(schemaRow.id),
    form: {
      id: String(formRow.id),
      applicationId: String(formRow.application_id),
      organizationId: String(formRow.organization_id),
      schemaKey: schema.schemaKey,
      schemaVersion: String(formRow.schema_version),
      currentStep: Number(formRow.current_step || 0),
      answers,
      sourceAttribution,
      aiSuggestions,
      validationErrors: JSON.parse(String(formRow.validation_errors_json || '[]')),
      missingRequiredCount: completenessCheck.errors.length,
      completedRequiredFields: completenessCheck.completedFields,
      totalRequiredVisible: completenessCheck.totalRequiredVisible,
      isComplete: completenessCheck.valid,
      applicantApproved: Boolean(formRow.applicant_approved),
      applicantApprovedByUserId: formRow.applicant_approved_by_user_id
        ? String(formRow.applicant_approved_by_user_id)
        : null,
      applicantApprovedAt: formRow.applicant_approved_at
        ? String(formRow.applicant_approved_at)
        : null,
      applicantAttestationText: formRow.applicant_attestation_text
        ? String(formRow.applicant_attestation_text)
        : null,
      revisionNumber: Number(formRow.revision_number || 1),
      lastAutosavedAt: formRow.last_autosaved_at ? String(formRow.last_autosaved_at) : null,
      updatedAt: String(formRow.updated_at),
    },
    revisions,
    caseMeta: {
      referenceNumber: String(appRow.reference_number),
      destinationCountry: String(appRow.destination_country),
      visaCategory: String(appRow.visa_category),
      internalStatus: String(appRow.internal_status),
    },
  };
}

export function prefillFormFromVerifiedData(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    actorUserId: string;
    overwriteExisting?: boolean;
  },
) {
  const { appRow, schema, formRow } = ensureApplicationForm(
    db,
    params.applicationId,
    params.organizationId,
    params.actorUserId,
  );

  const currentAnswers = JSON.parse(String(formRow.answers_json || '{}')) as Record<string, unknown>;
  const currentSources = JSON.parse(
    String(formRow.source_attribution_json || '{}'),
  ) as Record<string, AnswerSourceType>;

  const profile = db
    .prepare(
      `
      SELECT p.*, pr.passport_number_encrypted, pr.issuing_country, pr.issue_date, pr.expiry_date
      FROM applicant_profiles p
      LEFT JOIN passport_records pr ON pr.applicant_profile_id = p.id
      WHERE p.user_id = ? AND p.organization_id = ?
    `,
    )
    .get(String(appRow.applicant_user_id), params.organizationId) as
    | Record<string, unknown>
    | undefined;

  // Fetch only human-confirmed or officer-verified document extractions (NEVER unverified raw OCR!)
  const verifiedDocs = db
    .prepare(
      `
      SELECT d.document_type, d.review_status, e.extracted_json, e.corrected_json, e.is_confirmed
      FROM application_documents d
      JOIN document_extractions e ON e.document_id = d.id
      WHERE d.application_id = ? AND d.organization_id = ?
        AND (d.review_status = 'VERIFIED' OR e.is_confirmed = 1)
      ORDER BY d.updated_at DESC
    `,
    )
    .all(params.applicationId, params.organizationId) as Array<Record<string, unknown>>;

  const candidateValues: Array<{ key: string; value: unknown; source: AnswerSourceType }> = [];

  if (profile) {
    if (profile.full_legal_name) {
      candidateValues.push({
        key: 'fullLegalName',
        value: String(profile.full_legal_name),
        source: 'VERIFIED_PROFILE',
      });
    }
    if (profile.date_of_birth) {
      candidateValues.push({
        key: 'dateOfBirth',
        value: String(profile.date_of_birth),
        source: 'VERIFIED_PROFILE',
      });
    }
    if (profile.nationality) {
      candidateValues.push({
        key: 'nationality',
        value: String(profile.nationality),
        source: 'VERIFIED_PROFILE',
      });
    }
    if (profile.residence_country) {
      candidateValues.push({
        key: 'residenceCountry',
        value: String(profile.residence_country),
        source: 'VERIFIED_PROFILE',
      });
    }
    if (profile.intended_travel_start || appRow.intended_travel_date) {
      candidateValues.push({
        key: 'arrivalDate',
        value: String(profile.intended_travel_start || appRow.intended_travel_date),
        source: 'VERIFIED_PROFILE',
      });
    }
    if (profile.intended_travel_end) {
      candidateValues.push({
        key: 'departureDate',
        value: String(profile.intended_travel_end),
        source: 'VERIFIED_PROFILE',
      });
    }
    if (profile.passport_number_encrypted) {
      try {
        const plainPassport = decryptField(String(profile.passport_number_encrypted));
        candidateValues.push({
          key: 'passportNumber',
          value: plainPassport,
          source: 'VERIFIED_PASSPORT_RECORD',
        });
      } catch {
        // Ignore decryption failure gracefully
      }
    }
    if (profile.issuing_country) {
      candidateValues.push({
        key: 'passportIssuingCountry',
        value: String(profile.issuing_country),
        source: 'VERIFIED_PASSPORT_RECORD',
      });
    }
    if (profile.issue_date) {
      candidateValues.push({
        key: 'passportIssueDate',
        value: String(profile.issue_date),
        source: 'VERIFIED_PASSPORT_RECORD',
      });
    }
    if (profile.expiry_date) {
      candidateValues.push({
        key: 'passportExpiryDate',
        value: String(profile.expiry_date),
        source: 'VERIFIED_PASSPORT_RECORD',
      });
    }
  } else {
    // At least map case-level verified intake metadata
    candidateValues.push(
      { key: 'nationality', value: String(appRow.nationality), source: 'VERIFIED_PROFILE' },
      { key: 'residenceCountry', value: String(appRow.origin_country), source: 'VERIFIED_PROFILE' },
    );
    if (appRow.intended_travel_date) {
      candidateValues.push({
        key: 'arrivalDate',
        value: String(appRow.intended_travel_date),
        source: 'VERIFIED_PROFILE',
      });
    }
  }

  for (const doc of verifiedDocs) {
    const payload = JSON.parse(String(doc.corrected_json || doc.extracted_json || '{}')) as {
      fields?: Record<string, string>;
    };
    const fields = payload.fields || {};
    if (fields.employerName) {
      candidateValues.push({
        key: 'employerName',
        value: fields.employerName,
        source: 'CONFIRMED_EXTRACTION',
      });
    }
    if (fields.issuingCountry) {
      candidateValues.push({
        key: 'passportIssuingCountry',
        value: fields.issuingCountry,
        source: 'CONFIRMED_EXTRACTION',
      });
    }
    if (fields.issueDate) {
      candidateValues.push({
        key: 'passportIssueDate',
        value: fields.issueDate,
        source: 'CONFIRMED_EXTRACTION',
      });
    }
  }

  const nextAnswers: Record<string, unknown> = { ...currentAnswers };
  const nextSources: Record<string, AnswerSourceType> = { ...currentSources };
  const filledKeys: string[] = [];

  for (const cand of candidateValues) {
    if (!schema.properties[cand.key]) continue;
    const current = nextAnswers[cand.key];
    const isEmpty = current === undefined || current === null || String(current).trim() === '';
    if (isEmpty || params.overwriteExisting) {
      if (nextAnswers[cand.key] !== cand.value) {
        nextAnswers[cand.key] = cand.value;
        nextSources[cand.key] = cand.source;
        filledKeys.push(cand.key);
      }
    }
  }

  const now = new Date().toISOString();
  const validation = validateFormAgainstSchema(schema, nextAnswers, false);
  const fullCheck = validateFormAgainstSchema(schema, nextAnswers, true);
  const nextRevision = Number(formRow.revision_number || 1) + (filledKeys.length > 0 ? 1 : 0);

  db.prepare(`
    UPDATE application_forms
    SET answers_json = ?,
        source_attribution_json = ?,
        validation_errors_json = ?,
        is_complete = ?,
        applicant_approved = CASE WHEN ? > 0 THEN 0 ELSE applicant_approved END,
        revision_number = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(nextAnswers),
    JSON.stringify(nextSources),
    JSON.stringify(validation.errors),
    fullCheck.valid ? 1 : 0,
    filledKeys.length,
    nextRevision,
    now,
    String(formRow.id),
  );

  if (filledKeys.length > 0) {
    db.prepare(`
      INSERT INTO application_form_revisions (
        id, application_form_id, application_id, organization_id, revision_number,
        answers_json, source_attribution_json, changed_by_user_id, change_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('frev'),
      String(formRow.id),
      params.applicationId,
      params.organizationId,
      nextRevision,
      JSON.stringify(nextAnswers),
      JSON.stringify(nextSources),
      params.actorUserId,
      `Prefilled ${filledKeys.length} verified field(s): ${filledKeys.join(', ')}`,
      now,
    );
  }

  return {
    filledKeys,
    detail: getFormDetailPayload(db, params.applicationId, params.organizationId, params.actorUserId),
  };
}

export async function generateAiFormSuggestions(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    actorUserId: string;
  },
) {
  const { appRow, schema, formRow } = ensureApplicationForm(
    db,
    params.applicationId,
    params.organizationId,
    params.actorUserId,
  );

  const consentRow = db
    .prepare(
      `
      SELECT granted FROM applicant_consents
      WHERE user_id = ? AND organization_id = ? AND consent_type = 'EXTERNAL_AI_PROCESSING'
      ORDER BY granted_at DESC LIMIT 1
    `,
    )
    .get(String(appRow.applicant_user_id), params.organizationId) as
    | { granted: number }
    | undefined;

  if (!consentRow?.granted) {
    const err = new Error(
      'External AI processing consent (EXTERNAL_AI_PROCESSING) is required before generating AI form suggestions.',
    ) as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }

  const profile = db
    .prepare('SELECT * FROM applicant_profiles WHERE user_id = ? AND organization_id = ?')
    .get(String(appRow.applicant_user_id), params.organizationId) as
    | Record<string, unknown>
    | undefined;

  const suggestibleFields = Object.entries(schema.properties)
    .filter(([, spec]) => Boolean(spec.aiSuggestible))
    .map(([key, spec]) => ({ key, title: spec.title }));

  const answers = JSON.parse(String(formRow.answers_json || '{}')) as Record<string, unknown>;
  const now = new Date().toISOString();

  const factsContext = {
    destinationCountry: String(appRow.destination_country),
    visaCategory: String(appRow.visa_category),
    nationality: String(appRow.nationality),
    residenceCountry: String(appRow.origin_country),
    intendedTravelDate: appRow.intended_travel_date || profile?.intended_travel_start || null,
    intendedReturnDate: profile?.intended_travel_end || null,
    purposeOfTravel: appRow.purpose_of_travel || profile?.purpose_of_travel || null,
    fundingSource: answers.fundingSource || null,
    employmentStatus: answers.employmentStatus || null,
    employerName: answers.employerName || null,
  };

  let suggestionsList: Array<{
    fieldKey: string;
    suggestedValue: string;
    rationale: string;
    confidence: number;
  }> = [];
  let provider = 'DETERMINISTIC_DRAFT_ASSIST';
  let model = 'rule-template-v1';

  if (hasLiveGeminiKey()) {
    try {
      const ai = getGeminiClient();
      const prompt = [
        'Draft concise, accurate narrative suggestions for the requested visa form fields based ONLY on the verified case facts below.',
        'Do NOT invent financial amounts, job titles, dates, or legal eligibility claims.',
        `Target fields: ${JSON.stringify(suggestibleFields)}`,
        `Verified applicant/case facts: ${JSON.stringify(factsContext)}`,
      ].join('\n');

      const response = await ai.models.generateContent({
        model: AI_MODEL_DOCUMENT,
        contents: prompt,
        config: {
          systemInstruction:
            'Return JSON array "suggestions" containing fieldKey, suggestedValue, rationale, and confidence (0-1). Only include keys from target fields.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    fieldKey: { type: Type.STRING },
                    suggestedValue: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                  },
                  required: ['fieldKey', 'suggestedValue', 'rationale', 'confidence'],
                },
              },
            },
            required: ['suggestions'],
          },
        },
      });

      const parsed = JSON.parse((response.text || '{}').trim()) as {
        suggestions?: Array<{
          fieldKey: string;
          suggestedValue: string;
          rationale: string;
          confidence: number;
        }>;
      };
      const usage = (
        response as unknown as {
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        }
      ).usageMetadata;

      db.prepare(`
        INSERT INTO ai_usage_logs (
          id, organization_id, user_id, application_id, provider, model, prompt_version,
          input_tokens, output_tokens, status, created_at
        ) VALUES (?, ?, ?, ?, 'GEMINI', ?, ?, ?, ?, 'SUCCESS', ?)
      `).run(
        newId('aiu'),
        params.organizationId,
        params.actorUserId,
        params.applicationId,
        AI_MODEL_DOCUMENT,
        AI_SUGGESTION_PROMPT_VERSION,
        usage?.promptTokenCount || 0,
        usage?.candidatesTokenCount || 0,
        now,
      );

      if (Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
        suggestionsList = parsed.suggestions;
        provider = 'GEMINI';
        model = AI_MODEL_DOCUMENT;
      }
    } catch {
      db.prepare(`
        INSERT INTO ai_usage_logs (
          id, organization_id, user_id, application_id, provider, model, prompt_version,
          input_tokens, output_tokens, status, created_at
        ) VALUES (?, ?, ?, ?, 'GEMINI', ?, ?, 0, 0, 'FAILED', ?)
      `).run(
        newId('aiu'),
        params.organizationId,
        params.actorUserId,
        params.applicationId,
        AI_MODEL_DOCUMENT,
        AI_SUGGESTION_PROMPT_VERSION,
        now,
      );
    }
  }

  if (suggestionsList.length === 0) {
    const dest = String(appRow.destination_country);
    const cat = String(appRow.visa_category);
    const travelStart = factsContext.intendedTravelDate || 'the planned travel period';
    const basePurpose =
      factsContext.purposeOfTravel ||
      `Temporary ${cat.toLowerCase()} visit to ${dest} starting ${travelStart}.`;

    for (const field of suggestibleFields) {
      if (field.key === 'purposeSummary') {
        suggestionsList.push({
          fieldKey: 'purposeSummary',
          suggestedValue: `${basePurpose} Intended arrival is ${travelStart}${
            factsContext.intendedReturnDate ? ` with return on ${factsContext.intendedReturnDate}` : ''
          }.`,
          rationale: 'Drafted from verified case destination, visa category, and onboarding travel dates.',
          confidence: 0.84,
        });
      } else if (field.key === 'financialSupportExplanation') {
        suggestionsList.push({
          fieldKey: 'financialSupportExplanation',
          suggestedValue: `Trip expenses are funded via ${
            answers.fundingSource || 'applicant financial reserves'
          }, corroborated by uploaded financial statements and supporting documents.`,
          rationale: 'Summarized from selected funding mode; confirm exact figures match your uploaded statements.',
          confidence: 0.78,
        });
      } else if (field.key === 'homeCountryTiesSummary') {
        suggestionsList.push({
          fieldKey: 'homeCountryTiesSummary',
          suggestedValue: `Applicant resides in ${appRow.origin_country} (${
            answers.employerName ? `employed at ${answers.employerName}` : 'ongoing residence & commitments'
          }) and intends to return upon completion of the authorized visit.`,
          rationale: 'Drafted from residence country and employment metadata; review for accuracy.',
          confidence: 0.76,
        });
      }
    }
  }

  const existingSuggestions = JSON.parse(
    String(formRow.ai_suggestions_json || '{}'),
  ) as Record<string, AiFieldSuggestion>;

  for (const item of suggestionsList) {
    if (!schema.properties[item.fieldKey]) continue;
    existingSuggestions[item.fieldKey] = {
      fieldKey: item.fieldKey,
      suggestedValue: item.suggestedValue,
      rationale: item.rationale,
      confidence: Math.max(0.2, Math.min(0.95, Number(item.confidence || 0.75))),
      status: 'PENDING_REVIEW',
      provider,
      model,
      reviewRequired: true,
      generatedAt: now,
    };
  }

  db.prepare('UPDATE application_forms SET ai_suggestions_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(existingSuggestions),
    now,
    String(formRow.id),
  );

  return getFormDetailPayload(db, params.applicationId, params.organizationId, params.actorUserId);
}

export function saveFormDraft(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    actorUserId: string;
    actorRole: string;
    answersPatch: Record<string, unknown>;
    currentStep?: number;
    isAutosave?: boolean;
    changeReason?: string;
  },
) {
  const { schema, formRow } = ensureApplicationForm(
    db,
    params.applicationId,
    params.organizationId,
    params.actorUserId,
  );

  const prevAnswers = JSON.parse(String(formRow.answers_json || '{}')) as Record<string, unknown>;
  const prevSources = JSON.parse(
    String(formRow.source_attribution_json || '{}'),
  ) as Record<string, AnswerSourceType>;

  const nextAnswers: Record<string, unknown> = { ...prevAnswers };
  const nextSources: Record<string, AnswerSourceType> = { ...prevSources };
  const changedKeys: string[] = [];
  const defaultSource: AnswerSourceType =
    params.actorRole === 'APPLICANT' ? 'APPLICANT_INPUT' : 'STAFF_INPUT';

  for (const [k, v] of Object.entries(params.answersPatch || {})) {
    if (!schema.properties[k]) continue;
    if (prevAnswers[k] !== v) {
      nextAnswers[k] = v;
      nextSources[k] = defaultSource;
      changedKeys.push(k);
    }
  }

  const now = new Date().toISOString();
  const partialCheck = validateFormAgainstSchema(schema, nextAnswers, false);
  const fullCheck = validateFormAgainstSchema(schema, nextAnswers, true);
  const stepCount = schema.steps.length;
  const nextStep =
    typeof params.currentStep === 'number' && params.currentStep >= 0 && params.currentStep < stepCount
      ? params.currentStep
      : Number(formRow.current_step || 0);

  const shouldBumpRevision = changedKeys.length > 0 && !params.isAutosave;
  const nextRevision = Number(formRow.revision_number || 1) + (shouldBumpRevision ? 1 : 0);
  const approvalReset = changedKeys.length > 0 ? 0 : Number(formRow.applicant_approved || 0);

  db.prepare(`
    UPDATE application_forms
    SET current_step = ?,
        answers_json = ?,
        source_attribution_json = ?,
        validation_errors_json = ?,
        is_complete = ?,
        applicant_approved = ?,
        applicant_approved_at = CASE WHEN ? = 0 THEN NULL ELSE applicant_approved_at END,
        applicant_approved_by_user_id = CASE WHEN ? = 0 THEN NULL ELSE applicant_approved_by_user_id END,
        revision_number = ?,
        last_autosaved_at = CASE WHEN ? = 1 THEN ? ELSE last_autosaved_at END,
        updated_at = ?
    WHERE id = ?
  `).run(
    nextStep,
    JSON.stringify(nextAnswers),
    JSON.stringify(nextSources),
    JSON.stringify(partialCheck.errors),
    fullCheck.valid ? 1 : 0,
    approvalReset,
    approvalReset,
    approvalReset,
    nextRevision,
    params.isAutosave ? 1 : 0,
    now,
    now,
    String(formRow.id),
  );

  if (shouldBumpRevision) {
    db.prepare(`
      INSERT INTO application_form_revisions (
        id, application_form_id, application_id, organization_id, revision_number,
        answers_json, source_attribution_json, changed_by_user_id, change_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('frev'),
      String(formRow.id),
      params.applicationId,
      params.organizationId,
      nextRevision,
      JSON.stringify(nextAnswers),
      JSON.stringify(nextSources),
      params.actorUserId,
      params.changeReason?.trim() || `Updated fields: ${changedKeys.join(', ')}`,
      now,
    );
  }

  return {
    changedKeys,
    approvalReset: Number(formRow.applicant_approved || 0) === 1 && approvalReset === 0,
    detail: getFormDetailPayload(db, params.applicationId, params.organizationId, params.actorUserId),
  };
}

export function resolveAiSuggestion(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    actorUserId: string;
    fieldKey: string;
    decision: 'ACCEPT' | 'DISMISS';
    editedValue?: string;
  },
) {
  const { schema, formRow } = ensureApplicationForm(
    db,
    params.applicationId,
    params.organizationId,
    params.actorUserId,
  );

  const suggestions = JSON.parse(
    String(formRow.ai_suggestions_json || '{}'),
  ) as Record<string, AiFieldSuggestion>;
  const target = suggestions[params.fieldKey];
  if (!target) {
    throw new Error(`No AI suggestion found for field "${params.fieldKey}"`);
  }

  const now = new Date().toISOString();
  const answers = JSON.parse(String(formRow.answers_json || '{}')) as Record<string, unknown>;
  const sources = JSON.parse(
    String(formRow.source_attribution_json || '{}'),
  ) as Record<string, AnswerSourceType>;
  let nextRevision = Number(formRow.revision_number || 1);

  if (params.decision === 'ACCEPT') {
    const finalText =
      typeof params.editedValue === 'string' && params.editedValue.trim()
        ? params.editedValue.trim()
        : target.suggestedValue;
    target.status = 'ACCEPTED';
    target.reviewedAt = now;
    target.reviewedByUserId = params.actorUserId;
    answers[params.fieldKey] = finalText;
    sources[params.fieldKey] = 'AI_SUGGESTION_ACCEPTED';
    nextRevision += 1;

    db.prepare(`
      INSERT INTO application_form_revisions (
        id, application_form_id, application_id, organization_id, revision_number,
        answers_json, source_attribution_json, changed_by_user_id, change_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('frev'),
      String(formRow.id),
      params.applicationId,
      params.organizationId,
      nextRevision,
      JSON.stringify(answers),
      JSON.stringify(sources),
      params.actorUserId,
      `Reviewed and accepted AI suggestion for ${params.fieldKey}`,
      now,
    );
  } else {
    target.status = 'DISMISSED';
    target.reviewedAt = now;
    target.reviewedByUserId = params.actorUserId;
  }

  const fullCheck = validateFormAgainstSchema(schema, answers, true);
  db.prepare(`
    UPDATE application_forms
    SET answers_json = ?,
        source_attribution_json = ?,
        ai_suggestions_json = ?,
        validation_errors_json = ?,
        is_complete = ?,
        applicant_approved = CASE WHEN ? = 'ACCEPT' THEN 0 ELSE applicant_approved END,
        revision_number = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(answers),
    JSON.stringify(sources),
    JSON.stringify(suggestions),
    JSON.stringify(fullCheck.errors),
    fullCheck.valid ? 1 : 0,
    params.decision,
    nextRevision,
    now,
    String(formRow.id),
  );

  return getFormDetailPayload(db, params.applicationId, params.organizationId, params.actorUserId);
}

export function approveApplicationForm(
  db: AppDatabase,
  params: {
    applicationId: string;
    organizationId: string;
    actorUserId: string;
    attestationText: string;
  },
) {
  const { schema, formRow } = ensureApplicationForm(
    db,
    params.applicationId,
    params.organizationId,
    params.actorUserId,
  );

  const answers = JSON.parse(String(formRow.answers_json || '{}')) as Record<string, unknown>;
  const aiSuggestions = JSON.parse(
    String(formRow.ai_suggestions_json || '{}'),
  ) as Record<string, AiFieldSuggestion>;

  const pendingSuggestions = Object.values(aiSuggestions).filter(
    (s) => s.status === 'PENDING_REVIEW',
  );
  if (pendingSuggestions.length > 0) {
    const err = new Error(
      `Review all pending AI suggestions (${pendingSuggestions.map((p) => p.fieldKey).join(', ')}) by accepting or dismissing before applicant approval.`,
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const fullCheck = validateFormAgainstSchema(schema, answers, true);
  if (!fullCheck.valid) {
    const err = new Error(
      `Cannot approve incomplete form: ${fullCheck.errors.map((e) => e.message).slice(0, 3).join(' ')}`,
    ) as Error & { statusCode?: number; fieldErrors?: unknown };
    err.statusCode = 400;
    err.fieldErrors = fullCheck.errors;
    throw err;
  }

  const now = new Date().toISOString();
  const nextRevision = Number(formRow.revision_number || 1) + 1;
  const sourceAttr = String(formRow.source_attribution_json || '{}');

  db.prepare(`
    UPDATE application_forms
    SET validation_errors_json = '[]',
        is_complete = 1,
        applicant_approved = 1,
        applicant_approved_by_user_id = ?,
        applicant_approved_at = ?,
        applicant_attestation_text = ?,
        revision_number = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    params.actorUserId,
    now,
    params.attestationText,
    nextRevision,
    now,
    String(formRow.id),
  );

  db.prepare(`
    INSERT INTO application_form_revisions (
      id, application_form_id, application_id, organization_id, revision_number,
      answers_json, source_attribution_json, changed_by_user_id, change_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Applicant signed declaration and approved form', ?)
  `).run(
    newId('frev'),
    String(formRow.id),
    params.applicationId,
    params.organizationId,
    nextRevision,
    JSON.stringify(answers),
    sourceAttr,
    params.actorUserId,
    now,
  );

  return getFormDetailPayload(db, params.applicationId, params.organizationId, params.actorUserId);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderExportHtmlSummary(
  detail: ReturnType<typeof getFormDetailPayload>,
  schema: VisaFormJsonSchema,
): string {
  const rowsHtml = Object.entries(schema.properties)
    .map(([key, spec]) => {
      const val = detail.form.answers[key];
      const displayVal =
        val === undefined || val === null || val === ''
          ? '<em>Not provided</em>'
          : spec.sensitiveMasked && typeof val === 'string' && val.length > 4
            ? `••••${escapeHtml(val.slice(-4))}`
            : escapeHtml(String(val));
      const src = detail.form.sourceAttribution[key] || 'UNSET';
      return `<tr>
        <td>${escapeHtml(spec.title)}</td>
        <td>${displayVal}</td>
        <td><code>${escapeHtml(src)}</code></td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Meridian Visa Form Package — ${escapeHtml(detail.caseMeta.referenceNumber)}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #0f172a; margin: 36px; line-height: 1.5; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .meta { font-size: 13px; color: #475569; margin-bottom: 18px; }
    .notice { border: 1px solid #cbd5e1; background: #f8fafc; padding: 12px; font-size: 12px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e2e8f0; text-align: left; padding: 8px 10px; vertical-align: top; }
    th { font-size: 11px; text-transform: uppercase; color: #64748b; }
    code { font-family: monospace; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Visa Application Summary — ${escapeHtml(detail.caseMeta.referenceNumber)}</h1>
  <div class="meta">
    Schema: ${escapeHtml(schema.title)} (${escapeHtml(schema.version)}) &middot;
    Revision #${detail.form.revisionNumber} &middot;
    Applicant Approval: ${detail.form.applicantApproved ? `Approved (${escapeHtml(detail.form.applicantApprovedAt || '')})` : 'Pending Applicant Approval'}
  </div>
  <div class="notice">
    <strong>Compliance Notice:</strong> This summary package is generated from structured case records for authorized review or guided manual portal entry. Sensitive passport identifiers are masked in printable exports unless accessed via encrypted record view.
  </div>
  <table>
    <thead>
      <tr><th>Field</th><th>Value</th><th>Data Provenance</th></tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
}
