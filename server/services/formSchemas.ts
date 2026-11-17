import { AppDatabase } from '../db.ts';

export interface FieldCondition {
  field: string;
  equals?: string | boolean | number;
  in?: Array<string | boolean | number>;
  truthy?: boolean;
}

export interface JsonSchemaFieldSpec {
  type: 'string' | 'number' | 'boolean' | 'date';
  title: string;
  description?: string;
  placeholder?: string;
  enum?: Array<{ value: string; label: string }>;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'textarea' | 'country' | 'currency' | 'email';
  stepId: string;
  required?: boolean;
  visibleWhen?: FieldCondition;
  requiredWhen?: FieldCondition;
  aiSuggestible?: boolean;
  sensitiveMasked?: boolean;
}

export interface FormStepDefinition {
  id: string;
  title: string;
  description: string;
  order: number;
}

export interface VisaFormJsonSchema {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  schemaKey: string;
  version: string;
  title: string;
  destinationCountry: string;
  visaCategoryCode: string;
  isDemoRule: boolean;
  officialSourceUrl: string | null;
  steps: FormStepDefinition[];
  properties: Record<string, JsonSchemaFieldSpec>;
  required: string[];
}

export interface FormValidationError {
  fieldKey: string;
  stepId: string;
  message: string;
}

export const BUILTIN_FORM_SCHEMAS: VisaFormJsonSchema[] = [
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaKey: 'de-schengen-tourist',
    version: '2026.1-demo',
    title: 'Germany Short-Stay Visitor (Schengen C) — Demonstration Form Schema',
    destinationCountry: 'DE',
    visaCategoryCode: 'TOURIST',
    isDemoRule: true,
    officialSourceUrl: 'https://auswaertiges-amt.de/',
    steps: [
      {
        id: 'identity',
        title: 'Identity & Travel Document',
        description: 'Core biographical and passport fields mapped to verified applicant records.',
        order: 0,
      },
      {
        id: 'travel_lodging',
        title: 'Itinerary, Lodging & Prior Travel',
        description: 'Intended dates, accommodation arrangements, and Schengen travel history.',
        order: 1,
      },
      {
        id: 'financial_ties',
        title: 'Funding, Employment & Home Ties',
        description: 'Means of subsistence and narrative statements (AI draft suggestions require review).',
        order: 2,
      },
    ],
    required: [
      'fullLegalName',
      'dateOfBirth',
      'nationality',
      'residenceCountry',
      'passportNumber',
      'passportIssuingCountry',
      'passportIssueDate',
      'passportExpiryDate',
      'arrivalDate',
      'departureDate',
      'accommodationType',
      'purposeSummary',
      'fundingSource',
      'employmentStatus',
      'financialSupportExplanation',
      'homeCountryTiesSummary',
    ],
    properties: {
      fullLegalName: {
        type: 'string',
        title: 'Full Legal Name (As Printed on Passport)',
        minLength: 2,
        stepId: 'identity',
        required: true,
      },
      dateOfBirth: {
        type: 'date',
        title: 'Date of Birth',
        stepId: 'identity',
        required: true,
      },
      nationality: {
        type: 'string',
        title: 'Current Nationality (ISO-2)',
        minLength: 2,
        maxLength: 2,
        format: 'country',
        stepId: 'identity',
        required: true,
      },
      residenceCountry: {
        type: 'string',
        title: 'Country of Current Residence (ISO-2)',
        minLength: 2,
        maxLength: 2,
        format: 'country',
        stepId: 'identity',
        required: true,
      },
      passportNumber: {
        type: 'string',
        title: 'Passport Number',
        minLength: 5,
        maxLength: 20,
        stepId: 'identity',
        required: true,
        sensitiveMasked: true,
      },
      passportIssuingCountry: {
        type: 'string',
        title: 'Passport Issuing Country (ISO-2)',
        minLength: 2,
        maxLength: 2,
        format: 'country',
        stepId: 'identity',
        required: true,
      },
      passportIssueDate: {
        type: 'date',
        title: 'Passport Date of Issue',
        stepId: 'identity',
        required: true,
      },
      passportExpiryDate: {
        type: 'date',
        title: 'Passport Expiry Date',
        stepId: 'identity',
        required: true,
      },
      arrivalDate: {
        type: 'date',
        title: 'Intended Date of Arrival in Schengen Area',
        stepId: 'travel_lodging',
        required: true,
      },
      departureDate: {
        type: 'date',
        title: 'Intended Date of Departure from Schengen Area',
        stepId: 'travel_lodging',
        required: true,
      },
      accommodationType: {
        type: 'string',
        title: 'Primary Accommodation Type',
        stepId: 'travel_lodging',
        required: true,
        enum: [
          { value: 'HOTEL', label: 'Hotel or Commercial Lodging' },
          { value: 'HOST_FAMILY', label: 'Private Host / Family Member in Germany' },
          { value: 'TOUR_OPERATOR', label: 'Pre-booked Tour Package' },
        ],
      },
      hotelNameAndBookingRef: {
        type: 'string',
        title: 'Hotel Name & Booking Reference',
        placeholder: 'e.g. Hotel Maximilian Munich — Ref #BK-9021',
        minLength: 4,
        stepId: 'travel_lodging',
        visibleWhen: { field: 'accommodationType', equals: 'HOTEL' },
        requiredWhen: { field: 'accommodationType', equals: 'HOTEL' },
      },
      hostFullName: {
        type: 'string',
        title: 'Inviting Host Full Name',
        minLength: 2,
        stepId: 'travel_lodging',
        visibleWhen: { field: 'accommodationType', equals: 'HOST_FAMILY' },
        requiredWhen: { field: 'accommodationType', equals: 'HOST_FAMILY' },
      },
      hostAddressInGermany: {
        type: 'string',
        title: 'Host Residential Address in Germany',
        minLength: 8,
        stepId: 'travel_lodging',
        visibleWhen: { field: 'accommodationType', equals: 'HOST_FAMILY' },
        requiredWhen: { field: 'accommodationType', equals: 'HOST_FAMILY' },
      },
      hasPriorSchengenVisa: {
        type: 'boolean',
        title: 'Issued Schengen Visas in the Past 3 Years?',
        stepId: 'travel_lodging',
      },
      priorSchengenVisaReference: {
        type: 'string',
        title: 'Most Recent Schengen Visa Sticker Number / Dates',
        minLength: 4,
        stepId: 'travel_lodging',
        visibleWhen: { field: 'hasPriorSchengenVisa', equals: true },
        requiredWhen: { field: 'hasPriorSchengenVisa', equals: true },
      },
      purposeSummary: {
        type: 'string',
        title: 'Detailed Purpose of Travel Summary',
        format: 'textarea',
        minLength: 15,
        stepId: 'travel_lodging',
        required: true,
        aiSuggestible: true,
      },
      fundingSource: {
        type: 'string',
        title: 'Means of Subsistence / Trip Funding',
        stepId: 'financial_ties',
        required: true,
        enum: [
          { value: 'SELF_FUNDED', label: 'Self-Funded Personal Savings' },
          { value: 'EMPLOYER_SPONSORED', label: 'Employer Sponsored' },
          { value: 'HOST_SPONSORED', label: 'Formal Obligation / Host Sponsored' },
        ],
      },
      sponsorName: {
        type: 'string',
        title: 'Sponsor Full Name or Organization',
        minLength: 2,
        stepId: 'financial_ties',
        visibleWhen: { field: 'fundingSource', in: ['EMPLOYER_SPONSORED', 'HOST_SPONSORED'] },
        requiredWhen: { field: 'fundingSource', in: ['EMPLOYER_SPONSORED', 'HOST_SPONSORED'] },
      },
      employmentStatus: {
        type: 'string',
        title: 'Current Employment / Occupation Status',
        stepId: 'financial_ties',
        required: true,
        enum: [
          { value: 'EMPLOYED', label: 'Full-Time or Part-Time Employee' },
          { value: 'SELF_EMPLOYED', label: 'Self-Employed / Business Owner' },
          { value: 'STUDENT', label: 'Enrolled Student' },
          { value: 'RETIRED', label: 'Retired / Other' },
        ],
      },
      employerName: {
        type: 'string',
        title: 'Current Employer / Company Name',
        minLength: 2,
        stepId: 'financial_ties',
        visibleWhen: { field: 'employmentStatus', equals: 'EMPLOYED' },
        requiredWhen: { field: 'employmentStatus', equals: 'EMPLOYED' },
      },
      monthlyNetIncomeUsd: {
        type: 'number',
        title: 'Estimated Monthly Net Income (USD/EUR Equivalent)',
        stepId: 'financial_ties',
        visibleWhen: { field: 'employmentStatus', in: ['EMPLOYED', 'SELF_EMPLOYED'] },
        requiredWhen: { field: 'employmentStatus', in: ['EMPLOYED', 'SELF_EMPLOYED'] },
      },
      financialSupportExplanation: {
        type: 'string',
        title: 'Financial Coverage & Bank Statement Explanation',
        format: 'textarea',
        minLength: 15,
        stepId: 'financial_ties',
        required: true,
        aiSuggestible: true,
      },
      homeCountryTiesSummary: {
        type: 'string',
        title: 'Return Intent & Home Country Ties Statement',
        format: 'textarea',
        minLength: 15,
        stepId: 'financial_ties',
        required: true,
        aiSuggestible: true,
      },
    },
  },
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaKey: 'gb-standard-business',
    version: '2026.1-demo',
    title: 'UK Standard Visitor (Business) — Demonstration Form Schema',
    destinationCountry: 'GB',
    visaCategoryCode: 'BUSINESS',
    isDemoRule: true,
    officialSourceUrl: 'https://www.gov.uk/standard-visitor',
    steps: [
      {
        id: 'identity',
        title: 'Passport & Personal Identity',
        description: 'Applicant legal identity and travel document details.',
        order: 0,
      },
      {
        id: 'uk_business',
        title: 'UK Business Engagement',
        description: 'Host organization, meeting schedule, and permitted activity scope.',
        order: 1,
      },
      {
        id: 'financial_ties',
        title: 'Employment & Expenses',
        description: 'Employer sponsorship and narrative support explanation.',
        order: 2,
      },
    ],
    required: [
      'fullLegalName',
      'dateOfBirth',
      'nationality',
      'residenceCountry',
      'passportNumber',
      'passportExpiryDate',
      'arrivalDate',
      'departureDate',
      'ukHostOrganization',
      'ukHostCity',
      'purposeSummary',
      'employerName',
      'financialSupportExplanation',
    ],
    properties: {
      fullLegalName: { type: 'string', title: 'Full Legal Name', minLength: 2, stepId: 'identity', required: true },
      dateOfBirth: { type: 'date', title: 'Date of Birth', stepId: 'identity', required: true },
      nationality: { type: 'string', title: 'Nationality (ISO-2)', minLength: 2, maxLength: 2, format: 'country', stepId: 'identity', required: true },
      residenceCountry: { type: 'string', title: 'Residence Country (ISO-2)', minLength: 2, maxLength: 2, format: 'country', stepId: 'identity', required: true },
      passportNumber: { type: 'string', title: 'Passport Number', minLength: 5, stepId: 'identity', required: true, sensitiveMasked: true },
      passportExpiryDate: { type: 'date', title: 'Passport Expiry Date', stepId: 'identity', required: true },
      arrivalDate: { type: 'date', title: 'Intended UK Arrival Date', stepId: 'uk_business', required: true },
      departureDate: { type: 'date', title: 'Intended UK Departure Date', stepId: 'uk_business', required: true },
      ukHostOrganization: { type: 'string', title: 'UK Host Company / Event Organizer', minLength: 2, stepId: 'uk_business', required: true },
      ukHostCity: { type: 'string', title: 'UK Destination City', minLength: 2, stepId: 'uk_business', required: true },
      hasInvitationLetter: { type: 'boolean', title: 'Formal UK Host Invitation Issued?', stepId: 'uk_business' },
      invitationReference: {
        type: 'string',
        title: 'Invitation Letter Signatory / Reference',
        minLength: 3,
        stepId: 'uk_business',
        visibleWhen: { field: 'hasInvitationLetter', equals: true },
        requiredWhen: { field: 'hasInvitationLetter', equals: true },
      },
      purposeSummary: { type: 'string', title: 'Permitted Business Activity Description', format: 'textarea', minLength: 15, stepId: 'uk_business', required: true, aiSuggestible: true },
      employerName: { type: 'string', title: 'Home Employer Organization', minLength: 2, stepId: 'financial_ties', required: true },
      expensesCoveredByEmployer: { type: 'boolean', title: 'Are Travel & Subsistence Costs Paid by Your Employer?', stepId: 'financial_ties' },
      employerCostLetterNote: {
        type: 'string',
        title: 'Employer Expense Authorization Reference',
        minLength: 4,
        stepId: 'financial_ties',
        visibleWhen: { field: 'expensesCoveredByEmployer', equals: true },
        requiredWhen: { field: 'expensesCoveredByEmployer', equals: true },
      },
      financialSupportExplanation: { type: 'string', title: 'Trip Funding & Return Employment Explanation', format: 'textarea', minLength: 15, stepId: 'financial_ties', required: true, aiSuggestible: true },
    },
  },
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaKey: 'ca-study-permit',
    version: '2026.1-demo',
    title: 'Canada Study Permit — Demonstration Form Schema',
    destinationCountry: 'CA',
    visaCategoryCode: 'STUDENT',
    isDemoRule: true,
    officialSourceUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada.html',
    steps: [
      { id: 'identity', title: 'Applicant & Passport', description: 'Verified passport and biographical identity.', order: 0 },
      { id: 'institution', title: 'Designated Learning Institution (DLI)', description: 'Admission details and Provincial Attestation status.', order: 1 },
      { id: 'financial_ties', title: 'Tuition, Living Funds & Study Plan', description: 'Tuition payment, living expenses, and statement of purpose.', order: 2 },
    ],
    required: [
      'fullLegalName',
      'dateOfBirth',
      'nationality',
      'residenceCountry',
      'passportNumber',
      'passportExpiryDate',
      'dliNumber',
      'institutionName',
      'programTitle',
      'programStartDate',
      'tuitionFeeCad',
      'purposeSummary',
      'financialSupportExplanation',
    ],
    properties: {
      fullLegalName: { type: 'string', title: 'Full Legal Name', minLength: 2, stepId: 'identity', required: true },
      dateOfBirth: { type: 'date', title: 'Date of Birth', stepId: 'identity', required: true },
      nationality: { type: 'string', title: 'Nationality (ISO-2)', minLength: 2, maxLength: 2, format: 'country', stepId: 'identity', required: true },
      residenceCountry: { type: 'string', title: 'Residence Country (ISO-2)', minLength: 2, maxLength: 2, format: 'country', stepId: 'identity', required: true },
      passportNumber: { type: 'string', title: 'Passport Number', minLength: 5, stepId: 'identity', required: true, sensitiveMasked: true },
      passportExpiryDate: { type: 'date', title: 'Passport Expiry Date', stepId: 'identity', required: true },
      dliNumber: { type: 'string', title: 'Designated Learning Institution (DLI) Number', placeholder: 'e.g. O19359011033', minLength: 5, stepId: 'institution', required: true },
      institutionName: { type: 'string', title: 'Canadian Institution Name', minLength: 3, stepId: 'institution', required: true },
      programTitle: { type: 'string', title: 'Accepted Program & Credential Level', minLength: 3, stepId: 'institution', required: true },
      programStartDate: { type: 'date', title: 'Program Intake Start Date', stepId: 'institution', required: true },
      requiresPal: { type: 'boolean', title: 'Provincial Attestation Letter (PAL) Required for Level of Study?', stepId: 'institution' },
      palReferenceNumber: {
        type: 'string',
        title: 'Provincial Attestation Letter Reference Number',
        minLength: 4,
        stepId: 'institution',
        visibleWhen: { field: 'requiresPal', equals: true },
        requiredWhen: { field: 'requiresPal', equals: true },
      },
      tuitionFeeCad: { type: 'number', title: 'Annual Tuition Fee (CAD)', stepId: 'financial_ties', required: true },
      purposeSummary: { type: 'string', title: 'Study Plan & Academic Progression Rationale', format: 'textarea', minLength: 15, stepId: 'financial_ties', required: true, aiSuggestible: true },
      financialSupportExplanation: { type: 'string', title: 'First-Year Tuition & GIC / Proof of Funds Summary', format: 'textarea', minLength: 15, stepId: 'financial_ties', required: true, aiSuggestible: true },
    },
  },
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaKey: 'intl-visa-universal',
    version: '2026.1-demo',
    title: 'Universal Visa Intake & Summary — Demonstration Form Schema',
    destinationCountry: '*',
    visaCategoryCode: '*',
    isDemoRule: true,
    officialSourceUrl: null,
    steps: [
      { id: 'identity', title: 'Applicant & Passport Identity', description: 'Personal details and verified passport details.', order: 0 },
      { id: 'travel', title: 'Travel Itinerary & Purpose', description: 'Dates, origin/destination, and visit rationale.', order: 1 },
      { id: 'financial_ties', title: 'Funding & Return Declarations', description: 'Financial coverage and home-country ties.', order: 2 },
    ],
    required: [
      'fullLegalName',
      'dateOfBirth',
      'nationality',
      'residenceCountry',
      'passportNumber',
      'passportExpiryDate',
      'arrivalDate',
      'purposeSummary',
      'financialSupportExplanation',
    ],
    properties: {
      fullLegalName: { type: 'string', title: 'Full Legal Name', minLength: 2, stepId: 'identity', required: true },
      dateOfBirth: { type: 'date', title: 'Date of Birth', stepId: 'identity', required: true },
      nationality: { type: 'string', title: 'Nationality (ISO-2)', minLength: 2, maxLength: 2, format: 'country', stepId: 'identity', required: true },
      residenceCountry: { type: 'string', title: 'Residence Country (ISO-2)', minLength: 2, maxLength: 2, format: 'country', stepId: 'identity', required: true },
      passportNumber: { type: 'string', title: 'Passport Number', minLength: 5, stepId: 'identity', required: true, sensitiveMasked: true },
      passportExpiryDate: { type: 'date', title: 'Passport Expiry Date', stepId: 'identity', required: true },
      arrivalDate: { type: 'date', title: 'Intended Travel Start Date', stepId: 'travel', required: true },
      departureDate: { type: 'date', title: 'Intended Return / End Date', stepId: 'travel' },
      isEmployerSponsored: { type: 'boolean', title: 'Is This Trip Employer-Sponsored?', stepId: 'travel' },
      sponsorOrganization: {
        type: 'string',
        title: 'Sponsoring Employer or Host Organization',
        minLength: 2,
        stepId: 'travel',
        visibleWhen: { field: 'isEmployerSponsored', equals: true },
        requiredWhen: { field: 'isEmployerSponsored', equals: true },
      },
      purposeSummary: { type: 'string', title: 'Purpose of Travel Summary', format: 'textarea', minLength: 15, stepId: 'travel', required: true, aiSuggestible: true },
      financialSupportExplanation: { type: 'string', title: 'Financial Support & Subsistence Summary', format: 'textarea', minLength: 15, stepId: 'financial_ties', required: true, aiSuggestible: true },
    },
  },
];

export function seedFormSchemas(db: AppDatabase): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO visa_form_schemas (
      id, destination_country, visa_category_code, schema_key, version, title,
      is_demo_rule, official_source_url, schema_json, approval_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?)
    ON CONFLICT(schema_key, version) DO UPDATE SET
      title = excluded.title,
      official_source_url = excluded.official_source_url,
      schema_json = excluded.schema_json
  `);

  for (const s of BUILTIN_FORM_SCHEMAS) {
    stmt.run(
      `fschema_${s.schemaKey}_${s.version}`,
      s.destinationCountry,
      s.visaCategoryCode,
      s.schemaKey,
      s.version,
      s.title,
      s.isDemoRule ? 1 : 0,
      s.officialSourceUrl,
      JSON.stringify(s),
      now,
    );
  }
}

export function resolveFormSchemaForCase(
  db: AppDatabase,
  destinationCountry: string,
  visaCategory: string,
  organizationId?: string,
): { row: Record<string, unknown>; schema: VisaFormJsonSchema } {
  seedFormSchemas(db);

  let row: Record<string, unknown> | undefined;

  if (organizationId) {
    row = db
      .prepare(
        `
        SELECT * FROM visa_form_schemas
        WHERE organization_id = ? AND destination_country = ? AND visa_category_code = ? AND approval_status = 'PUBLISHED'
        ORDER BY COALESCE(approved_at, created_at) DESC, created_at DESC LIMIT 1
      `,
      )
      .get(organizationId, destinationCountry, visaCategory) as Record<string, unknown> | undefined;
  }

  if (!row) {
    row = db
      .prepare(
        `
        SELECT * FROM visa_form_schemas
        WHERE organization_id IS NULL AND destination_country = ? AND visa_category_code = ? AND approval_status = 'PUBLISHED'
        ORDER BY COALESCE(approved_at, created_at) DESC, created_at DESC LIMIT 1
      `,
      )
      .get(destinationCountry, visaCategory) as Record<string, unknown> | undefined;
  }

  if (!row && organizationId) {
    row = db
      .prepare(
        `
        SELECT * FROM visa_form_schemas
        WHERE organization_id = ? AND destination_country = '*' AND visa_category_code = '*' AND approval_status = 'PUBLISHED'
        ORDER BY COALESCE(approved_at, created_at) DESC, created_at DESC LIMIT 1
      `,
      )
      .get(organizationId) as Record<string, unknown> | undefined;
  }

  if (!row) {
    row = db
      .prepare(
        `
        SELECT * FROM visa_form_schemas
        WHERE organization_id IS NULL AND destination_country = '*' AND visa_category_code = '*' AND approval_status = 'PUBLISHED'
        ORDER BY COALESCE(approved_at, created_at) DESC, created_at DESC LIMIT 1
      `,
      )
      .get() as Record<string, unknown> | undefined;
  }

  if (!row) {
    throw new Error('No published visa form schema found');
  }

  return {
    row,
    schema: JSON.parse(String(row.schema_json)) as VisaFormJsonSchema,
  };
}

export function evaluateFieldCondition(
  cond: FieldCondition | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!cond) return true;
  const val = answers[cond.field];
  if (cond.equals !== undefined) {
    return val === cond.equals;
  }
  if (cond.in !== undefined) {
    return cond.in.includes(val as string | boolean | number);
  }
  if (cond.truthy) {
    return Boolean(val);
  }
  return true;
}

export function validateFormAgainstSchema(
  schema: VisaFormJsonSchema,
  answers: Record<string, unknown>,
  requireAllComplete: boolean,
): { valid: boolean; errors: FormValidationError[]; completedFields: number; totalRequiredVisible: number } {
  const errors: FormValidationError[] = [];
  let completedFields = 0;
  let totalRequiredVisible = 0;

  for (const [key, spec] of Object.entries(schema.properties)) {
    const visible = evaluateFieldCondition(spec.visibleWhen, answers);
    if (!visible) continue;

    const isRequired =
      Boolean(spec.required || schema.required.includes(key)) ||
      (spec.requiredWhen ? evaluateFieldCondition(spec.requiredWhen, answers) : false);

    const rawVal = answers[key];
    const hasValue =
      spec.type === 'boolean'
        ? typeof rawVal === 'boolean'
        : spec.type === 'number'
          ? rawVal !== undefined && rawVal !== null && rawVal !== '' && Number.isFinite(Number(rawVal))
          : typeof rawVal === 'string' && rawVal.trim().length > 0;

    if (isRequired) {
      totalRequiredVisible += 1;
      if (hasValue) completedFields += 1;
    }

    if (isRequired && !hasValue) {
      if (requireAllComplete) {
        errors.push({
          fieldKey: key,
          stepId: spec.stepId,
          message: `${spec.title} is required.`,
        });
      }
      continue;
    }

    if (!hasValue) continue;

    if (spec.type === 'number') {
      const n = Number(rawVal);
      if (!Number.isFinite(n) || n < 0) {
        errors.push({
          fieldKey: key,
          stepId: spec.stepId,
          message: `${spec.title} must be a non-negative number.`,
        });
      }
    } else if (spec.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rawVal))) {
        errors.push({
          fieldKey: key,
          stepId: spec.stepId,
          message: `${spec.title} must use YYYY-MM-DD format.`,
        });
      }
    } else if (spec.type === 'string') {
      const s = String(rawVal).trim();
      if (spec.minLength && s.length < spec.minLength) {
        errors.push({
          fieldKey: key,
          stepId: spec.stepId,
          message: `${spec.title} must be at least ${spec.minLength} characters.`,
        });
      }
      if (spec.maxLength && s.length > spec.maxLength) {
        errors.push({
          fieldKey: key,
          stepId: spec.stepId,
          message: `${spec.title} must be at most ${spec.maxLength} characters.`,
        });
      }
      if (spec.enum && !spec.enum.some((opt) => opt.value === s)) {
        errors.push({
          fieldKey: key,
          stepId: spec.stepId,
          message: `${spec.title} contains an invalid selection.`,
        });
      }
    }
  }

  // Cross-field date check: departureDate > arrivalDate when both present
  if (
    typeof answers.arrivalDate === 'string' &&
    typeof answers.departureDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(answers.arrivalDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(answers.departureDate) &&
    answers.departureDate <= answers.arrivalDate
  ) {
    errors.push({
      fieldKey: 'departureDate',
      stepId: schema.properties.departureDate?.stepId || 'travel_lodging',
      message: 'Departure date must be after intended arrival date.',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    completedFields,
    totalRequiredVisible,
  };
}
