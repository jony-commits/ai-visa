import type { AppDatabase } from './db.ts';
import type { ConsentType } from './types.ts';

export interface ValidationFailure {
  valid: false;
  error: string;
  fieldErrors: Record<string, string>;
}

export interface ValidationSuccess<T> {
  valid: true;
  value: T;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const ISO_COUNTRY_RE = /^[A-Z]{2}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSPORT_RE = /^[A-Za-z0-9-]{5,20}$/;

function isValidIsoDate(val: string): boolean {
  if (!ISO_DATE_RE.test(val)) return false;
  const parsed = new Date(`${val}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(val);
}

export interface ValidatedOnboardingInput {
  fullLegalName: string;
  dateOfBirth: string;
  nationality: string;
  residenceCountry: string;
  phone: string;
  email: string;
  travelDestination: string;
  visaCategory: string;
  intendedTravelStart: string | null;
  intendedTravelEnd: string | null;
  purposeOfTravel: string | null;
  dependents: Array<{ name: string; relationship: string; dateOfBirth: string }>;
  passport?: {
    passportNumber?: string;
    issuingCountry: string;
    issueDate: string;
    expiryDate: string;
  };
  consents?: Partial<Record<ConsentType, boolean>>;
}

export function validateApplicantOnboardingPayload(
  db: AppDatabase,
  rawBody: Record<string, any>,
  defaultEmail: string,
): ValidationResult<ValidatedOnboardingInput> {
  const fieldErrors: Record<string, string> = {};

  const fullLegalName = String(rawBody.fullLegalName || '').trim();
  if (fullLegalName.length < 2) {
    fieldErrors.fullLegalName = 'Full legal name must be at least 2 characters';
  }

  const dateOfBirth = String(rawBody.dateOfBirth || '').trim();
  if (!isValidIsoDate(dateOfBirth)) {
    fieldErrors.dateOfBirth = 'Valid date of birth (YYYY-MM-DD) is required';
  } else if (dateOfBirth >= new Date().toISOString().slice(0, 10)) {
    fieldErrors.dateOfBirth = 'Date of birth must be in the past';
  }

  const nationality = String(rawBody.nationality || '').trim().toUpperCase();
  if (!ISO_COUNTRY_RE.test(nationality)) {
    fieldErrors.nationality = 'Nationality must be a 2-letter ISO country code';
  }

  const residenceCountry = String(rawBody.residenceCountry || '').trim().toUpperCase();
  if (!ISO_COUNTRY_RE.test(residenceCountry)) {
    fieldErrors.residenceCountry = 'Residence country must be a 2-letter ISO country code';
  }

  const phone = String(rawBody.phone || '').trim();
  if (phone.length < 7 || !/^[+0-9()\-\s]{7,24}$/.test(phone)) {
    fieldErrors.phone = 'Valid contact phone number is required';
  }

  const email = String(rawBody.email || defaultEmail).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    fieldErrors.email = 'Valid contact email address is required';
  }

  const travelDestination = String(rawBody.travelDestination || '').trim().toUpperCase();
  if (!ISO_COUNTRY_RE.test(travelDestination)) {
    fieldErrors.travelDestination = 'Destination country must be a 2-letter ISO country code';
  } else {
    const countryRow = db
      .prepare('SELECT code FROM visa_countries WHERE code = ? AND enabled = 1')
      .get(travelDestination);
    if (!countryRow) {
      fieldErrors.travelDestination = `Country ${travelDestination} is not enabled in the catalog`;
    }
  }

  const visaCategory = String(rawBody.visaCategory || '').trim().toUpperCase();
  const categoryRow = db
    .prepare('SELECT code FROM visa_categories WHERE code = ?')
    .get(visaCategory);
  if (!categoryRow) {
    fieldErrors.visaCategory = 'Select a valid visa category';
  }

  const intendedTravelStart = rawBody.intendedTravelStart
    ? String(rawBody.intendedTravelStart).trim()
    : null;
  const intendedTravelEnd = rawBody.intendedTravelEnd
    ? String(rawBody.intendedTravelEnd).trim()
    : null;

  if (intendedTravelStart && !isValidIsoDate(intendedTravelStart)) {
    fieldErrors.intendedTravelStart = 'Arrival date must use YYYY-MM-DD format';
  }
  if (intendedTravelEnd && !isValidIsoDate(intendedTravelEnd)) {
    fieldErrors.intendedTravelEnd = 'Departure date must use YYYY-MM-DD format';
  }
  if (intendedTravelStart && intendedTravelEnd && intendedTravelEnd < intendedTravelStart) {
    fieldErrors.intendedTravelEnd = 'Departure date cannot precede arrival date';
  }

  const dependents: Array<{ name: string; relationship: string; dateOfBirth: string }> = [];
  if (Array.isArray(rawBody.dependents)) {
    for (let i = 0; i < rawBody.dependents.length; i++) {
      const dep = rawBody.dependents[i] || {};
      const name = String(dep.name || '').trim();
      const relationship = String(dep.relationship || '').trim();
      const depDob = String(dep.dateOfBirth || '').trim();
      if (!name || !relationship || !isValidIsoDate(depDob)) {
        fieldErrors[`dependents.${i}`] =
          'Each dependent requires a name, relationship, and valid birth date (YYYY-MM-DD)';
      } else {
        dependents.push({ name, relationship, dateOfBirth: depDob });
      }
    }
  }

  let validatedPassport: ValidatedOnboardingInput['passport'] | undefined;
  if (rawBody.passport && typeof rawBody.passport === 'object') {
    const p = rawBody.passport as Record<string, any>;
    const hasAnyPassportField = Boolean(
      p.passportNumber || p.issuingCountry || p.issueDate || p.expiryDate,
    );
    if (hasAnyPassportField) {
      const issuingCountry = String(p.issuingCountry || '').trim().toUpperCase();
      const issueDate = String(p.issueDate || '').trim();
      const expiryDate = String(p.expiryDate || '').trim();
      const passportNumber = p.passportNumber ? String(p.passportNumber).trim() : undefined;

      if (!ISO_COUNTRY_RE.test(issuingCountry)) {
        fieldErrors['passport.issuingCountry'] = 'Passport issuing country must be a 2-letter ISO code';
      }
      if (!isValidIsoDate(issueDate)) {
        fieldErrors['passport.issueDate'] = 'Passport issue date (YYYY-MM-DD) is required';
      }
      if (!isValidIsoDate(expiryDate)) {
        fieldErrors['passport.expiryDate'] = 'Passport expiry date (YYYY-MM-DD) is required';
      }
      if (isValidIsoDate(issueDate) && isValidIsoDate(expiryDate) && expiryDate <= issueDate) {
        fieldErrors['passport.expiryDate'] = 'Passport expiry date must be after issue date';
      }
      if (passportNumber && !PASSPORT_RE.test(passportNumber)) {
        fieldErrors['passport.passportNumber'] =
          'Passport number must be 5–20 alphanumeric characters';
      }

      validatedPassport = {
        passportNumber,
        issuingCountry,
        issueDate,
        expiryDate,
      };
    }
  }

  const consents = rawBody.consents as Partial<Record<ConsentType, boolean>> | undefined;
  if (consents && consents.PERSONAL_DATA_PROCESSING === false) {
    fieldErrors['consents.PERSONAL_DATA_PROCESSING'] =
      'Personal data processing consent is required to maintain an immigration profile';
  }

  if (Object.keys(fieldErrors).length > 0) {
    const firstMsg = Object.values(fieldErrors)[0];
    return { valid: false, error: firstMsg, fieldErrors };
  }

  return {
    valid: true,
    value: {
      fullLegalName,
      dateOfBirth,
      nationality,
      residenceCountry,
      phone,
      email,
      travelDestination,
      visaCategory,
      intendedTravelStart,
      intendedTravelEnd,
      purposeOfTravel: rawBody.purposeOfTravel ? String(rawBody.purposeOfTravel).trim() : null,
      dependents,
      passport: validatedPassport,
      consents,
    },
  };
}

export interface ValidatedCreateCaseInput {
  destinationCountry: string;
  visaCategory: string;
  routeId: string | null;
  originCountry: string;
  nationality: string;
  intendedTravelDate: string | null;
  purposeOfTravel: string | null;
  submissionNotes: string | null;
  applicantUserId?: string;
  assignedConsultantId?: string | null;
}

export function validateCreateCasePayload(
  db: AppDatabase,
  rawBody: Record<string, any>,
): ValidationResult<ValidatedCreateCaseInput> {
  const fieldErrors: Record<string, string> = {};

  let destinationCountry = rawBody.destinationCountry
    ? String(rawBody.destinationCountry).trim().toUpperCase()
    : '';
  let visaCategory = rawBody.visaCategory
    ? String(rawBody.visaCategory).trim().toUpperCase()
    : '';
  const routeId = rawBody.routeId ? String(rawBody.routeId).trim() : null;

  if (routeId) {
    const route = db
      .prepare('SELECT id, destination_country, visa_category_code FROM visa_routes WHERE id = ?')
      .get(routeId) as
      | { id: string; destination_country: string; visa_category_code: string }
      | undefined;
    if (!route) {
      fieldErrors.routeId = 'Selected visa route was not found';
    } else {
      if (!destinationCountry) destinationCountry = route.destination_country;
      if (!visaCategory) visaCategory = route.visa_category_code;
      if (
        destinationCountry !== route.destination_country ||
        visaCategory !== route.visa_category_code
      ) {
        fieldErrors.routeId = 'Selected route does not match chosen country and visa category';
      }
    }
  }

  if (!ISO_COUNTRY_RE.test(destinationCountry)) {
    fieldErrors.destinationCountry = 'Destination country is required';
  } else {
    const c = db
      .prepare('SELECT code FROM visa_countries WHERE code = ? AND enabled = 1')
      .get(destinationCountry);
    if (!c) {
      fieldErrors.destinationCountry = `Country ${destinationCountry} is not enabled`;
    }
  }

  if (!visaCategory) {
    fieldErrors.visaCategory = 'Visa category is required';
  } else {
    const cat = db
      .prepare('SELECT code FROM visa_categories WHERE code = ?')
      .get(visaCategory);
    if (!cat) {
      fieldErrors.visaCategory = `Visa category ${visaCategory} is invalid`;
    }
  }

  const originCountry = String(rawBody.originCountry || '').trim().toUpperCase();
  if (!ISO_COUNTRY_RE.test(originCountry)) {
    fieldErrors.originCountry = 'Origin / residence country must be a 2-letter ISO code';
  }

  const nationality = String(rawBody.nationality || '').trim().toUpperCase();
  if (!ISO_COUNTRY_RE.test(nationality)) {
    fieldErrors.nationality = 'Applicant nationality must be a 2-letter ISO code';
  }

  const intendedTravelDate = rawBody.intendedTravelDate
    ? String(rawBody.intendedTravelDate).trim()
    : null;
  if (intendedTravelDate && !isValidIsoDate(intendedTravelDate)) {
    fieldErrors.intendedTravelDate = 'Intended travel date must use YYYY-MM-DD format';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, error: Object.values(fieldErrors)[0], fieldErrors };
  }

  return {
    valid: true,
    value: {
      destinationCountry,
      visaCategory,
      routeId,
      originCountry,
      nationality,
      intendedTravelDate,
      purposeOfTravel: rawBody.purposeOfTravel ? String(rawBody.purposeOfTravel).trim() : null,
      submissionNotes: rawBody.submissionNotes ? String(rawBody.submissionNotes).trim() : null,
      applicantUserId: rawBody.applicantUserId ? String(rawBody.applicantUserId).trim() : undefined,
      assignedConsultantId:
        rawBody.assignedConsultantId === null
          ? null
          : rawBody.assignedConsultantId
            ? String(rawBody.assignedConsultantId).trim()
            : undefined,
    },
  };
}
