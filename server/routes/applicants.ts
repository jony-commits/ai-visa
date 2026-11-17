import { Router } from 'express';
import { encryptField, maskPassportNumber } from '../crypto.ts';
import { AppDatabase, newId, writeAuditLog } from '../db.ts';
import { requireAuth } from '../middleware.ts';
import { CONSENT_TYPES } from '../types.ts';
import { validateApplicantOnboardingPayload } from '../validation.ts';

export function createApplicantsRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/applicant/profile', requireAuth, (req, res) => {
    const profile = db
      .prepare('SELECT * FROM applicant_profiles WHERE user_id = ? AND organization_id = ?')
      .get(req.auth!.userId, req.auth!.organizationId) as Record<string, unknown> | undefined;

    let passport: Record<string, unknown> | null = null;
    if (profile) {
      passport = (db
        .prepare(
          `
          SELECT id, passport_number_masked, issuing_country, issue_date, expiry_date, updated_at
          FROM passport_records
          WHERE applicant_profile_id = ?
        `,
        )
        .get(String(profile.id)) as Record<string, unknown> | undefined) ?? null;
    }

    const consents = db
      .prepare(
        `
        SELECT consent_type, granted, policy_version, granted_at, revoked_at
        FROM applicant_consents
        WHERE user_id = ? AND organization_id = ?
        ORDER BY granted_at DESC
      `,
      )
      .all(req.auth!.userId, req.auth!.organizationId) as Array<{
      consent_type: string;
      granted: number;
    }>;

    const personalConsentGranted = consents.some(
      (c) => c.consent_type === 'PERSONAL_DATA_PROCESSING' && Boolean(c.granted),
    );

    res.json({
      profile: profile
        ? {
            ...profile,
            dependents: JSON.parse(String(profile.dependents_json || '[]')),
            onboardingCompleted: Boolean(profile.onboarding_completed),
          }
        : null,
      passport,
      consents,
      onboardingChecklist: {
        identity: Boolean(profile?.full_legal_name && profile?.date_of_birth && profile?.phone),
        passport: Boolean(passport?.passport_number_masked && passport?.expiry_date),
        travel: Boolean(profile?.travel_destination && profile?.visa_category),
        consent: personalConsentGranted,
      },
    });
  });

  router.put('/applicant/profile', requireAuth, (req, res) => {
    const validation = validateApplicantOnboardingPayload(
      db,
      (req.body || {}) as Record<string, unknown>,
      req.auth!.email,
    );
    if (validation.valid === false) {
      res.status(400).json({
        error: validation.error,
        fieldErrors: validation.fieldErrors,
      });
      return;
    }

    const {
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
      purposeOfTravel,
      dependents,
      passport,
      consents,
    } = validation.value;

    const now = new Date().toISOString();
    const existing = db
      .prepare('SELECT id FROM applicant_profiles WHERE user_id = ? AND organization_id = ?')
      .get(req.auth!.userId, req.auth!.organizationId) as { id: string } | undefined;

    const profileId = existing ? existing.id : newId('prof');

    if (existing) {
      db.prepare(`
        UPDATE applicant_profiles
        SET full_legal_name = ?, date_of_birth = ?, nationality = ?, residence_country = ?,
            phone = ?, email = ?, travel_destination = ?, visa_category = ?,
            intended_travel_start = ?, intended_travel_end = ?, purpose_of_travel = ?,
            dependents_json = ?, onboarding_completed = 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND organization_id = ?
      `).run(
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
        purposeOfTravel,
        JSON.stringify(dependents),
        now,
        profileId,
        req.auth!.userId,
        req.auth!.organizationId,
      );
    } else {
      db.prepare(`
        INSERT INTO applicant_profiles (
          id, user_id, organization_id, full_legal_name, date_of_birth, nationality,
          residence_country, phone, email, travel_destination, visa_category,
          intended_travel_start, intended_travel_end, purpose_of_travel,
          dependents_json, onboarding_completed, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        profileId,
        req.auth!.userId,
        req.auth!.organizationId,
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
        purposeOfTravel,
        JSON.stringify(dependents),
        now,
      );
    }

    if (passport) {
      const existingPassport = db
        .prepare('SELECT id FROM passport_records WHERE applicant_profile_id = ?')
        .get(profileId) as { id: string } | undefined;

      if (passport.passportNumber) {
        const encrypted = encryptField(passport.passportNumber);
        const masked = maskPassportNumber(passport.passportNumber);
        if (existingPassport) {
          db.prepare(`
            UPDATE passport_records
            SET passport_number_encrypted = ?, passport_number_masked = ?,
                issuing_country = ?, issue_date = ?, expiry_date = ?, updated_at = ?
            WHERE id = ?
          `).run(
            encrypted,
            masked,
            passport.issuingCountry,
            passport.issueDate,
            passport.expiryDate,
            now,
            existingPassport.id,
          );
        } else {
          db.prepare(`
            INSERT INTO passport_records (
              id, applicant_profile_id, passport_number_encrypted, passport_number_masked,
              issuing_country, issue_date, expiry_date, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            newId('pass'),
            profileId,
            encrypted,
            masked,
            passport.issuingCountry,
            passport.issueDate,
            passport.expiryDate,
            now,
            now,
          );
        }
      } else if (existingPassport) {
        db.prepare(`
          UPDATE passport_records
          SET issuing_country = ?, issue_date = ?, expiry_date = ?, updated_at = ?
          WHERE id = ?
        `).run(
          passport.issuingCountry,
          passport.issueDate,
          passport.expiryDate,
          now,
          existingPassport.id,
        );
      }
    }

    if (consents) {
      for (const consentType of CONSENT_TYPES) {
        if (typeof consents[consentType] === 'boolean') {
          const granted = consents[consentType]!;
          db.prepare(
            'DELETE FROM applicant_consents WHERE user_id = ? AND organization_id = ? AND consent_type = ?',
          ).run(req.auth!.userId, req.auth!.organizationId, consentType);

          db.prepare(`
            INSERT INTO applicant_consents (
              id, user_id, organization_id, consent_type, granted, policy_version, granted_at, revoked_at, ip_address
            ) VALUES (?, ?, ?, ?, ?, '2026-01', ?, ?, ?)
          `).run(
            newId('con'),
            req.auth!.userId,
            req.auth!.organizationId,
            consentType,
            granted ? 1 : 0,
            now,
            granted ? null : now,
            req.ip || null,
          );
        }
      }
    }

    writeAuditLog(db, {
      organizationId: req.auth!.organizationId,
      actorUserId: req.auth!.userId,
      action: 'APPLICANT_PROFILE_SAVED',
      resourceType: 'ApplicantProfile',
      resourceId: profileId,
      metadata: { passportUpdated: Boolean(passport?.passportNumber) },
      ipAddress: req.ip,
    });

    const savedProfile = db
      .prepare('SELECT * FROM applicant_profiles WHERE id = ?')
      .get(profileId) as Record<string, unknown>;
    const savedPassport = db
      .prepare(
        'SELECT id, passport_number_masked, issuing_country, issue_date, expiry_date, updated_at FROM passport_records WHERE applicant_profile_id = ?',
      )
      .get(profileId);
    const savedConsents = db
      .prepare(
        'SELECT consent_type, granted, policy_version, granted_at, revoked_at FROM applicant_consents WHERE user_id = ? AND organization_id = ?',
      )
      .all(req.auth!.userId, req.auth!.organizationId);

    res.json({
      profile: {
        ...savedProfile,
        dependents: JSON.parse(String(savedProfile.dependents_json || '[]')),
        onboardingCompleted: Boolean(savedProfile.onboarding_completed),
      },
      passport: savedPassport || null,
      consents: savedConsents,
    });
  });

  router.put('/applicant/consents', requireAuth, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const now = new Date().toISOString();

    const keyMap: Record<string, (typeof CONSENT_TYPES)[number]> = {
      PERSONAL_DATA_PROCESSING: 'PERSONAL_DATA_PROCESSING',
      EXTERNAL_AI_PROCESSING: 'EXTERNAL_AI_PROCESSING',
      COMMUNICATIONS: 'COMMUNICATIONS',
      personalDataProcessing: 'PERSONAL_DATA_PROCESSING',
      externalAiProcessing: 'EXTERNAL_AI_PROCESSING',
      communications: 'COMMUNICATIONS',
    };

    const updates: Partial<Record<(typeof CONSENT_TYPES)[number], boolean>> = {};
    for (const [k, canonical] of Object.entries(keyMap)) {
      if (typeof body[k] === 'boolean') {
        updates[canonical] = body[k] as boolean;
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'Provide at least one boolean consent flag to update.' });
      return;
    }

    for (const [consentType, granted] of Object.entries(updates)) {
      db.prepare(
        'DELETE FROM applicant_consents WHERE user_id = ? AND organization_id = ? AND consent_type = ?',
      ).run(req.auth!.userId, req.auth!.organizationId, consentType);

      db.prepare(`
        INSERT INTO applicant_consents (
          id, user_id, organization_id, consent_type, granted, policy_version, granted_at, revoked_at, ip_address
        ) VALUES (?, ?, ?, ?, ?, '2026-01', ?, ?, ?)
      `).run(
        newId('con'),
        req.auth!.userId,
        req.auth!.organizationId,
        consentType,
        granted ? 1 : 0,
        now,
        granted ? null : now,
        req.ip || null,
      );
    }

    writeAuditLog(db, {
      organizationId: req.auth!.organizationId,
      actorUserId: req.auth!.userId,
      action: 'APPLICANT_CONSENTS_UPDATED',
      resourceType: 'ApplicantConsent',
      resourceId: req.auth!.userId,
      metadata: updates,
      ipAddress: req.ip,
    });

    const consents = db
      .prepare(
        'SELECT consent_type, granted, policy_version, granted_at, revoked_at FROM applicant_consents WHERE user_id = ? AND organization_id = ?',
      )
      .all(req.auth!.userId, req.auth!.organizationId);

    res.json({ consents });
  });

  router.get('/applicant/export', requireAuth, (req, res) => {
    const profile = db
      .prepare('SELECT * FROM applicant_profiles WHERE user_id = ? AND organization_id = ?')
      .get(req.auth!.userId, req.auth!.organizationId) as Record<string, unknown> | undefined;

    const passport = profile
      ? db
          .prepare(
            'SELECT passport_number_masked, issuing_country, issue_date, expiry_date, updated_at FROM passport_records WHERE applicant_profile_id = ?',
          )
          .get(String(profile.id))
      : null;

    const consents = db
      .prepare(
        'SELECT consent_type, granted, policy_version, granted_at, revoked_at FROM applicant_consents WHERE user_id = ? AND organization_id = ?',
      )
      .all(req.auth!.userId, req.auth!.organizationId);

    const applications = db
      .prepare(
        'SELECT id, reference_number, destination_country, visa_category, internal_status, government_status, government_status_source, created_at FROM visa_applications WHERE applicant_user_id = ? AND organization_id = ?',
      )
      .all(req.auth!.userId, req.auth!.organizationId);

    writeAuditLog(db, {
      organizationId: req.auth!.organizationId,
      actorUserId: req.auth!.userId,
      action: 'PERSONAL_DATA_EXPORTED',
      resourceType: 'User',
      resourceId: req.auth!.userId,
      ipAddress: req.ip,
    });

    res.json({
      exportedAt: new Date().toISOString(),
      account: {
        id: req.auth!.userId,
        email: req.auth!.email,
        fullName: req.auth!.fullName,
        organizationName: req.auth!.organizationName,
      },
      profile: profile || null,
      passport,
      consents,
      applications,
    });
  });

  return router;
}
