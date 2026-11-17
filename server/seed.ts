import { encryptField, hashPassword, maskPassportNumber } from './crypto.ts';
import { AppDatabase, writeAuditLog } from './db.ts';
import { seedFormSchemas } from './services/formSchemas.ts';
import { seedNotificationTemplates } from './services/notifications.ts';
import { ensureOrgWorkflowStages } from './workflow.ts';

export const DEMO_PASSWORD = 'MeridianDemo!2026';

export function seedDatabase(db: AppDatabase): void {
  seedFormSchemas(db);
  seedNotificationTemplates(db);

  const existingCountries = db
    .prepare('SELECT COUNT(*) AS count FROM visa_countries')
    .get() as { count: number };

  if (existingCountries.count === 0) {
    const insertCountry = db.prepare(
      'INSERT INTO visa_countries (code, name, region, enabled) VALUES (?, ?, ?, 1)',
    );
    const countries = [
      ['DE', 'Germany', 'Europe (Schengen)'],
      ['GB', 'United Kingdom', 'Europe'],
      ['CA', 'Canada', 'North America'],
      ['US', 'United States', 'North America'],
      ['AU', 'Australia', 'Oceania'],
      ['JP', 'Japan', 'Asia'],
      ['SG', 'Singapore', 'Asia'],
      ['IN', 'India', 'Asia'],
      ['BR', 'Brazil', 'South America'],
      ['AE', 'United Arab Emirates', 'Middle East'],
    ];
    for (const [code, name, region] of countries) {
      insertCountry.run(code, name, region);
    }
  }

  const existingCategories = db
    .prepare('SELECT COUNT(*) AS count FROM visa_categories')
    .get() as { count: number };

  if (existingCategories.count === 0) {
    const insertCategory = db.prepare(
      'INSERT INTO visa_categories (code, name, description) VALUES (?, ?, ?)',
    );
    const categories = [
      ['TOURIST', 'Tourist / Visitor', 'Short-term leisure, tourism, or family visit travel'],
      ['BUSINESS', 'Business Visitor', 'Short-term meetings, conferences, and commercial visits'],
      ['STUDENT', 'Student / Study', 'Academic study at an accredited educational institution'],
      ['WORK', 'Work / Skilled Employment', 'Employer-sponsored or skilled worker authorization'],
      ['FAMILY', 'Family / Dependent', 'Spousal, partner, or dependent family reunification'],
      ['TRANSIT', 'Transit', 'Airport or territorial transit to a third destination'],
      ['OTHER', 'Other Country-Specific', 'Specialized diplomatic, research, or humanitarian categories'],
    ];
    for (const [code, name, description] of categories) {
      insertCategory.run(code, name, description);
    }
  }

  const existingRoutes = db
    .prepare('SELECT COUNT(*) AS count FROM visa_routes')
    .get() as { count: number };

  if (existingRoutes.count === 0) {
    const now = new Date().toISOString();
    const insertRoute = db.prepare(`
      INSERT INTO visa_routes (
        id, destination_country, visa_category_code, title, rule_version,
        is_demo_rule, official_source_url, source_verified_at, effective_from, summary
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `);

    insertRoute.run(
      'route_de_tourist_demo',
      'DE',
      'TOURIST',
      'Germany Short-Stay Visitor (Schengen Type C — Demonstration Rule)',
      'demo-2026.1',
      'https://auswaertiges-amt.de/',
      now,
      '2026-01-01T00:00:00.000Z',
      'Sample demonstration route for testing Schengen visitor workflows. Verify current embassy requirements before filing.',
    );
    insertRoute.run(
      'route_gb_business_demo',
      'GB',
      'BUSINESS',
      'United Kingdom Standard Visitor (Business — Demonstration Rule)',
      'demo-2026.1',
      'https://www.gov.uk/standard-visitor',
      now,
      '2026-01-01T00:00:00.000Z',
      'Sample demonstration route for UK Standard Visitor business travel. Do not treat as legal advice.',
    );
    insertRoute.run(
      'route_ca_student_demo',
      'CA',
      'STUDENT',
      'Canada Study Permit (Demonstration Rule)',
      'demo-2026.1',
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada.html',
      now,
      '2026-01-01T00:00:00.000Z',
      'Sample demonstration route for academic study permit preparation and document intake.',
    );
  }

  const existingUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (existingUsers.count > 0) {
    return;
  }

  const now = new Date().toISOString();
  const passwordHash = hashPassword(DEMO_PASSWORD);

  // Organizations (2 distinct tenants for strict multi-tenant testing)
  const insertOrg = db.prepare(`
    INSERT INTO organizations (id, name, slug, country_code, plan_tier, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `);
  insertOrg.run('org_apex', 'Apex Global Mobility', 'apex-global', 'US', 'ENTERPRISE', now, now);
  insertOrg.run('org_pacific', 'Pacific Rim Immigration', 'pacific-rim', 'CA', 'STANDARD', now, now);
  ensureOrgWorkflowStages(db, 'org_apex');
  ensureOrgWorkflowStages(db, 'org_pacific');

  const insertUser = db.prepare(`
    INSERT INTO users (
      id, email, password_hash, full_name, email_verified, mfa_enabled,
      is_platform_admin, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)
  `);

  insertUser.run('usr_super', 'superadmin@meridianvisa.demo', passwordHash, 'Claire Vance', 1, now, now);
  insertUser.run('usr_admin_apex', 'admin@apexmobility.demo', passwordHash, 'Marcus Chen', 0, now, now);
  insertUser.run('usr_consultant_apex', 'consultant@apexmobility.demo', passwordHash, 'Elena Rostova', 0, now, now);
  insertUser.run('usr_officer_apex', 'officer@apexmobility.demo', passwordHash, 'David Okafor', 0, now, now);
  insertUser.run('usr_applicant_apex', 'applicant@apexmobility.demo', passwordHash, 'Aarav Mehta', 0, now, now);
  insertUser.run('usr_applicant2_apex', 'applicant2@apexmobility.demo', passwordHash, 'Priya Nair', 0, now, now);
  insertUser.run('usr_consultant_pacific', 'consultant@pacificrim.demo', passwordHash, 'Sofia Alvarez', 0, now, now);

  const insertMember = db.prepare(`
    INSERT INTO organization_members (id, organization_id, user_id, role, status, created_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?)
  `);

  insertMember.run('mem_super_apex', 'org_apex', 'usr_super', 'AGENCY_ADMIN', now);
  insertMember.run('mem_admin_apex', 'org_apex', 'usr_admin_apex', 'AGENCY_ADMIN', now);
  insertMember.run('mem_consultant_apex', 'org_apex', 'usr_consultant_apex', 'CONSULTANT', now);
  insertMember.run('mem_officer_apex', 'org_apex', 'usr_officer_apex', 'VERIFICATION_OFFICER', now);
  insertMember.run('mem_applicant_apex', 'org_apex', 'usr_applicant_apex', 'APPLICANT', now);
  insertMember.run('mem_applicant2_apex', 'org_apex', 'usr_applicant2_apex', 'APPLICANT', now);
  insertMember.run('mem_consultant_pacific', 'org_pacific', 'usr_consultant_pacific', 'CONSULTANT', now);

  // Applicant profile + encrypted passport
  db.prepare(`
    INSERT INTO applicant_profiles (
      id, user_id, organization_id, full_legal_name, date_of_birth, nationality,
      residence_country, phone, email, travel_destination, visa_category,
      intended_travel_start, intended_travel_end, purpose_of_travel,
      dependents_json, onboarding_completed, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    'prof_aarav',
    'usr_applicant_apex',
    'org_apex',
    'Aarav Mehta',
    '1993-07-14',
    'IN',
    'US',
    '+1-415-555-0148',
    'applicant@apexmobility.demo',
    'DE',
    'TOURIST',
    '2027-04-10',
    '2027-04-24',
    'Cultural tourism and visiting relatives in Munich and Berlin',
    JSON.stringify([{ name: 'Diya Mehta', relationship: 'Spouse', dateOfBirth: '1994-11-02' }]),
    now,
  );

  const samplePassport = 'Z9482714';
  db.prepare(`
    INSERT INTO passport_records (
      id, applicant_profile_id, passport_number_encrypted, passport_number_masked,
      issuing_country, issue_date, expiry_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'pass_aarav',
    'prof_aarav',
    encryptField(samplePassport),
    maskPassportNumber(samplePassport),
    'IN',
    '2022-03-15',
    '2032-03-14',
    now,
    now,
  );

  const insertConsent = db.prepare(`
    INSERT INTO applicant_consents (
      id, user_id, organization_id, consent_type, granted, policy_version, granted_at
    ) VALUES (?, ?, ?, ?, 1, '2026-01', ?)
  `);
  insertConsent.run('con_1', 'usr_applicant_apex', 'org_apex', 'PERSONAL_DATA_PROCESSING', now);
  insertConsent.run('con_2', 'usr_applicant_apex', 'org_apex', 'EXTERNAL_AI_PROCESSING', now);
  insertConsent.run('con_3', 'usr_applicant_apex', 'org_apex', 'COMMUNICATIONS', now);

  // Sample Cases in Apex Global Mobility + 1 isolated case in Pacific Rim Immigration
  const insertCase = db.prepare(`
    INSERT INTO visa_applications (
      id, reference_number, organization_id, applicant_user_id, assigned_consultant_id,
      route_id, destination_country, origin_country, nationality, visa_category,
      rule_version, internal_status, government_status, government_status_source,
      intended_travel_date, submission_notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCase.run(
    'app_apex_1',
    'MRD-2026-1001',
    'org_apex',
    'usr_applicant_apex',
    'usr_consultant_apex',
    'route_de_tourist_demo',
    'DE',
    'US',
    'IN',
    'TOURIST',
    'demo-2026.1',
    'DOCUMENT_COLLECTION',
    'NOT_SUBMITTED',
    'UNAVAILABLE',
    '2027-04-10',
    'Initial Schengen tourist intake completed; awaiting travel insurance and bank statements.',
    now,
    now,
  );

  insertCase.run(
    'app_apex_2',
    'MRD-2026-1002',
    'org_apex',
    'usr_applicant_apex',
    'usr_consultant_apex',
    'route_gb_business_demo',
    'GB',
    'US',
    'IN',
    'BUSINESS',
    'demo-2026.1',
    'CONSULTANT_REVIEW',
    'NOT_SUBMITTED',
    'UNAVAILABLE',
    '2027-06-05',
    'Annual partner summit in London; employer letter verified.',
    now,
    now,
  );

  insertCase.run(
    'app_apex_3',
    'MRD-2026-1003',
    'org_apex',
    'usr_applicant2_apex',
    null,
    'route_ca_student_demo',
    'CA',
    'IN',
    'IN',
    'STUDENT',
    'demo-2026.1',
    'APPLICANT_INFO_PENDING',
    'NOT_SUBMITTED',
    'UNAVAILABLE',
    '2027-09-01',
    'New graduate study intake awaiting consultant assignment.',
    now,
    now,
  );

  insertCase.run(
    'app_pacific_1',
    'MRD-2026-2001',
    'org_pacific',
    'usr_consultant_pacific',
    'usr_consultant_pacific',
    'route_ca_student_demo',
    'CA',
    'BR',
    'BR',
    'STUDENT',
    'demo-2026.1',
    'APPLICANT_INFO_PENDING',
    'NOT_SUBMITTED',
    'UNAVAILABLE',
    '2027-09-01',
    'Isolated tenant case inside Pacific Rim Immigration.',
    now,
    now,
  );

  const insertHistory = db.prepare(`
    INSERT INTO application_status_history (
      id, application_id, organization_id, from_status, to_status, changed_by_user_id, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertHistory.run('hist_1', 'app_apex_1', 'org_apex', null, 'DRAFT', 'usr_applicant_apex', 'Application created', now);
  insertHistory.run('hist_2', 'app_apex_1', 'org_apex', 'DRAFT', 'APPLICANT_INFO_PENDING', 'usr_consultant_apex', 'Intake started', now);
  insertHistory.run('hist_3', 'app_apex_1', 'org_apex', 'APPLICANT_INFO_PENDING', 'DOCUMENT_COLLECTION', 'usr_consultant_apex', 'Applicant profile verified', now);
  insertHistory.run('hist_4', 'app_apex_2', 'org_apex', null, 'CONSULTANT_REVIEW', 'usr_consultant_apex', 'Seeded review case', now);

  db.prepare(`
    INSERT INTO case_tasks (
      id, application_id, organization_id, title, description, assigned_to_user_id, due_at, status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'tsk_1',
    'app_apex_1',
    'org_apex',
    'Confirm Schengen medical travel insurance coverage (€30,000 min)',
    'Upload policy certificate showing dates covering full trip.',
    'usr_applicant_apex',
    '2026-12-15T00:00:00.000Z',
    'OPEN',
    'usr_consultant_apex',
    now,
    now,
  );

  db.prepare(`
    INSERT INTO case_notes (
      id, application_id, organization_id, author_user_id, visibility, body, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'note_1',
    'app_apex_1',
    'org_apex',
    'usr_consultant_apex',
    'APPLICANT_VISIBLE',
    'Welcome to Apex Global Mobility. Please verify your passport expiry and consent checkboxes in your profile.',
    now,
  );

  db.prepare(`
    INSERT INTO case_notes (
      id, application_id, organization_id, author_user_id, visibility, body, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'note_2',
    'app_apex_1',
    'org_apex',
    'usr_officer_apex',
    'INTERNAL',
    'Internal review note: check US visa residency stamp validity before scheduling VFS slot.',
    now,
  );

  const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const fiveDaysOut = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const threeWeeksOut = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    UPDATE visa_applications
    SET target_submission_deadline = ?, stage_due_at = ?, appointment_at = ?
    WHERE id = 'app_apex_1'
  `).run(twoWeeksOut, fiveDaysOut, threeWeeksOut);

  db.prepare(`
    INSERT INTO case_appointments (
      id, application_id, organization_id, appointment_type, center_name,
      center_address, scheduled_at, timezone, booking_reference, status,
      instructions, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'apt_apex_1',
    'app_apex_1',
    'org_apex',
    'BIOMETRICS',
    'VFS Global San Francisco Schengen VAC',
    '642 Harrison St, Suite 200, San Francisco, CA',
    threeWeeksOut,
    'America/Los_Angeles',
    'VFS-DE-2026-8841',
    'SCHEDULED',
    'Bring original passport, printed appointment letter, and biometric fee receipt.',
    'usr_consultant_apex',
    now,
    now,
  );

  writeAuditLog(db, {
    organizationId: 'org_apex',
    actorUserId: 'usr_admin_apex',
    action: 'SEED_INITIALIZED',
    resourceType: 'Organization',
    resourceId: 'org_apex',
    metadata: { note: 'Demonstration workspace initialized' },
  });
}
