import { AppDatabase, newId } from '../db.ts';
import {
  AI_MODEL_DOCUMENT,
  hasLiveGeminiKey,
  NormalizedDocumentExtraction,
  normalizeDocumentWithGemini,
  PROMPT_VERSION_EXTRACTION,
} from './aiProvider.ts';
import { runDocumentOcr } from './ocr.ts';
import { getPrivateObject } from './storage.ts';

export const AI_EXTRACTION_DISCLAIMER =
  'Unverified OCR/AI extraction. Human confirmation is required; automated checks cannot certify document authenticity from an image.';

function extractRegexField(text: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

export function classifyDocumentDeterministically(
  text: string,
  declaredType: string,
  filename: string,
): string {
  const combined = `${text}\n${filename}`.toLowerCase();
  if (combined.includes('passport') || combined.includes('p<') || combined.includes('passport no')) {
    return 'PASSPORT';
  }
  if (combined.includes('bank statement') || combined.includes('closing balance') || combined.includes('account balance')) {
    return 'BANK_STATEMENT';
  }
  if (combined.includes('employment') || combined.includes('employer') || combined.includes('annual salary')) {
    return 'EMPLOYMENT_LETTER';
  }
  if (combined.includes('payslip') || combined.includes('net pay')) {
    return 'PAYSLIP';
  }
  if (combined.includes('insurance') || combined.includes('medical coverage')) {
    return 'TRAVEL_INSURANCE';
  }
  if (combined.includes('admission') || combined.includes('university') || combined.includes('enrollment')) {
    return 'ADMISSION_LETTER';
  }
  if (combined.includes('invitation')) {
    return 'INVITATION_LETTER';
  }
  if (combined.includes('itinerary') || combined.includes('flight')) {
    return 'TRAVEL_ITINERARY';
  }
  return declaredType || 'OTHER';
}

export function parseStructuredFieldsDeterministically(
  rawText: string,
  declaredType: string,
  filename: string,
): NormalizedDocumentExtraction {
  const detectedDocumentType = classifyDocumentDeterministically(rawText, declaredType, filename);

  const fullName = extractRegexField(rawText, [
    /(?:Full[ \t]*Name|Legal[ \t]*Name|Account[ \t]*Holder|Employee[ \t]*Name|Name)[ \t]*[:=][ \t]*([A-Za-z][A-Za-z \t.'-]{2,60})/i,
  ]);
  const dateOfBirth = extractRegexField(rawText, [
    /(?:Date[ \t]*of[ \t]*Birth|DOB|Birth[ \t]*Date)[ \t]*[:=][ \t]*(\d{4}-\d{2}-\d{2})/i,
  ]);
  const nationality = extractRegexField(rawText, [
    /(?:Nationality|Citizenship)[ \t]*[:=][ \t]*([A-Z]{2,3})/i,
  ]);
  const passportNumber = extractRegexField(rawText, [
    /(?:Passport[ \t]*(?:No|Number|#))[ \t]*[:=][ \t]*([A-Z0-9-]{5,20})/i,
  ]);
  const issuingCountry = extractRegexField(rawText, [
    /(?:Issuing[ \t]*Country|Issued[ \t]*By)[ \t]*[:=][ \t]*([A-Z]{2,3})/i,
  ]);
  const issueDate = extractRegexField(rawText, [
    /(?:Issue[ \t]*Date|Date[ \t]*of[ \t]*Issue)[ \t]*[:=][ \t]*(\d{4}-\d{2}-\d{2})/i,
  ]);
  const expiryDate = extractRegexField(rawText, [
    /(?:Expiry[ \t]*Date|Expiration[ \t]*Date|Date[ \t]*of[ \t]*Expiry|Valid[ \t]*Until)[ \t]*[:=][ \t]*(\d{4}-\d{2}-\d{2})/i,
  ]);
  const employerName = extractRegexField(rawText, [
    /(?:Employer|Company)[ \t]*[:=][ \t]*([A-Za-z0-9][A-Za-z0-9 \t.,&'-]{2,60})/i,
  ]);
  const jobTitle = extractRegexField(rawText, [
    /(?:Job[ \t]*Title|Position|Role)[ \t]*[:=][ \t]*([A-Za-z0-9 \t.,/-]{2,60})/i,
  ]);
  const annualSalary = extractRegexField(rawText, [
    /(?:Annual[ \t]*Salary|Salary)[ \t]*[:=][ \t]*([A-Z$€£0-9,. \t]{3,30})/i,
  ]);
  const bankName = extractRegexField(rawText, [
    /(?:Bank[ \t]*Name|Institution)[ \t]*[:=][ \t]*([A-Za-z0-9 \t.,&'-]{2,60})/i,
  ]);
  const accountHolderName = extractRegexField(rawText, [
    /(?:Account[ \t]*Holder)[ \t]*[:=][ \t]*([A-Za-z][A-Za-z \t.'-]{2,60})/i,
  ]);
  const closingBalance = extractRegexField(rawText, [
    /(?:Closing[ \t]*Balance|Balance)[ \t]*[:=][ \t]*([0-9,.]{2,20})/i,
  ]);
  const currency = extractRegexField(rawText, [
    /(?:Currency)[ \t]*[:=][ \t]*([A-Z]{3})/i,
  ]);
  const statementDate = extractRegexField(rawText, [
    /(?:Statement[ \t]*Date|Period[ \t]*End)[ \t]*[:=][ \t]*(\d{4}-\d{2}-\d{2})/i,
  ]);

  const fields: NormalizedDocumentExtraction['fields'] = {
    ...(fullName ? { fullName } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(nationality ? { nationality: nationality.slice(0, 2) } : {}),
    ...(passportNumber ? { passportNumber } : {}),
    ...(issuingCountry ? { issuingCountry: issuingCountry.slice(0, 2) } : {}),
    ...(issueDate ? { issueDate } : {}),
    ...(expiryDate ? { expiryDate } : {}),
    ...(employerName ? { employerName } : {}),
    ...(jobTitle ? { jobTitle } : {}),
    ...(annualSalary ? { annualSalary } : {}),
    ...(bankName ? { bankName } : {}),
    ...(accountHolderName ? { accountHolderName } : {}),
    ...(closingBalance ? { closingBalance } : {}),
    ...(currency ? { currency } : {}),
    ...(statementDate ? { statementDate } : {}),
  };

  const lower = rawText.toLowerCase();
  const unreadableOrIncomplete =
    lower.includes('[illegible]') ||
    lower.includes('unreadable') ||
    rawText.trim().length < 25;
  const missingPagesDetected =
    lower.includes('page 1 of 2') && !lower.includes('page 2 of 2')
      ? true
      : lower.includes('missing page');

  const extractedCount = Object.keys(fields).length;
  let confidenceScore = extractedCount >= 3 ? 0.88 : extractedCount >= 1 ? 0.72 : 0.42;
  if (unreadableOrIncomplete) confidenceScore = Math.min(confidenceScore, 0.48);
  if (missingPagesDetected) confidenceScore = Math.min(confidenceScore, 0.55);

  const fieldConfidences: Record<string, number> = {};
  for (const key of Object.keys(fields)) {
    fieldConfidences[key] = confidenceScore;
  }

  const evidenceSnippets = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 5);

  return {
    detectedDocumentType,
    confidenceScore,
    unreadableOrIncomplete,
    missingPagesDetected,
    readabilityNotes: unreadableOrIncomplete
      ? 'Low-readability or sparse OCR text detected. Manual officer inspection required.'
      : missingPagesDetected
        ? 'Possible missing pages detected in multi-page document.'
        : 'Structured fields parsed deterministically; human confirmation required.',
    fields,
    fieldConfidences,
    evidenceSnippets,
  };
}

export async function extractAndPersistDocumentData(
  db: AppDatabase,
  params: {
    documentId: string;
    actorUserId?: string;
  },
) {
  const doc = db
    .prepare(
      `
      SELECT d.*, a.applicant_user_id, a.organization_id
      FROM application_documents d
      JOIN visa_applications a ON a.id = d.application_id
      WHERE d.id = ?
    `,
    )
    .get(params.documentId) as Record<string, unknown> | undefined;

  if (!doc) {
    throw new Error('Document record not found');
  }

  if (doc.malware_scan_status === 'QUARANTINED') {
    throw new Error('Cannot process quarantined document');
  }

  const buffer = getPrivateObject(String(doc.storage_key));
  if (!buffer) {
    throw new Error('Document binary object missing from private storage');
  }

  const consentRow = db
    .prepare(
      `
      SELECT granted FROM applicant_consents
      WHERE user_id = ? AND organization_id = ? AND consent_type = 'EXTERNAL_AI_PROCESSING'
      ORDER BY granted_at DESC LIMIT 1
    `,
    )
    .get(String(doc.applicant_user_id), String(doc.organization_id)) as
    | { granted: number }
    | undefined;

  const allowExternalAi = Boolean(consentRow?.granted);

  const ocr = await runDocumentOcr({
    buffer,
    mimeType: String(doc.mime_type),
    filename: String(doc.original_filename),
    allowExternalAi,
  });

  let aiProvider = 'DETERMINISTIC_RULE_PARSER';
  let modelName = 'deterministic-v1';
  let normalized: NormalizedDocumentExtraction;

  if (allowExternalAi && hasLiveGeminiKey()) {
    try {
      normalized = await normalizeDocumentWithGemini(db, {
        organizationId: String(doc.organization_id),
        userId: params.actorUserId,
        applicationId: String(doc.application_id),
        documentId: String(doc.id),
        rawOcrText: ocr.rawText,
        filename: String(doc.original_filename),
        declaredDocumentType: String(doc.document_type),
      });
      aiProvider = 'GEMINI';
      modelName = AI_MODEL_DOCUMENT;
    } catch {
      normalized = parseStructuredFieldsDeterministically(
        ocr.rawText,
        String(doc.document_type),
        String(doc.original_filename),
      );
    }
  } else {
    normalized = parseStructuredFieldsDeterministically(
      ocr.rawText,
      String(doc.document_type),
      String(doc.original_filename),
    );
  }

  const now = new Date().toISOString();
  const existingExtraction = db
    .prepare('SELECT id FROM document_extractions WHERE document_id = ?')
    .get(String(doc.id)) as { id: string } | undefined;

  const extractedPayload = JSON.stringify({
    fields: normalized.fields,
    fieldConfidences: normalized.fieldConfidences,
    unreadableOrIncomplete: normalized.unreadableOrIncomplete,
    missingPagesDetected: normalized.missingPagesDetected,
    readabilityNotes: normalized.readabilityNotes,
    evidenceSnippets: normalized.evidenceSnippets,
    externalAiConsentGranted: allowExternalAi,
  });

  if (existingExtraction) {
    db.prepare(`
      UPDATE document_extractions
      SET ocr_provider = ?, ai_provider = ?, model_name = ?, prompt_version = ?,
          raw_ocr_text = ?, detected_document_type = ?, extracted_json = ?,
          confidence_score = ?, is_confirmed = 0, confirmed_by_user_id = NULL,
          confirmed_at = NULL, ai_disclaimer = ?, updated_at = ?
      WHERE id = ?
    `).run(
      ocr.provider,
      aiProvider,
      modelName,
      PROMPT_VERSION_EXTRACTION,
      ocr.rawText,
      normalized.detectedDocumentType,
      extractedPayload,
      normalized.confidenceScore,
      AI_EXTRACTION_DISCLAIMER,
      now,
      existingExtraction.id,
    );
  } else {
    db.prepare(`
      INSERT INTO document_extractions (
        id, document_id, application_id, organization_id, ocr_provider, ai_provider,
        model_name, prompt_version, raw_ocr_text, detected_document_type,
        extracted_json, confidence_score, is_confirmed, ai_disclaimer, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      newId('ext'),
      String(doc.id),
      String(doc.application_id),
      String(doc.organization_id),
      ocr.provider,
      aiProvider,
      modelName,
      PROMPT_VERSION_EXTRACTION,
      ocr.rawText,
      normalized.detectedDocumentType,
      extractedPayload,
      normalized.confidenceScore,
      AI_EXTRACTION_DISCLAIMER,
      now,
      now,
    );
  }

  // Update document status to EXTRACTED (if still PENDING) and sync expiry_date if extracted & missing
  const nextExpiry =
    (typeof doc.expiry_date === 'string' && doc.expiry_date ? doc.expiry_date : null) ||
    normalized.fields.expiryDate ||
    null;
  db.prepare(`
    UPDATE application_documents
    SET review_status = CASE WHEN review_status = 'PENDING' THEN 'EXTRACTED' ELSE review_status END,
        expiry_date = COALESCE(expiry_date, ?),
        updated_at = ?
    WHERE id = ?
  `).run(nextExpiry, now, String(doc.id));

  return {
    documentId: String(doc.id),
    ocrProvider: ocr.provider,
    aiProvider,
    modelName,
    confidenceScore: normalized.confidenceScore,
    detectedDocumentType: normalized.detectedDocumentType,
    fields: normalized.fields,
  };
}
