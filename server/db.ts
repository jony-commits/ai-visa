import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDatabase = DatabaseSync;

export function newId(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function openDatabase(dbPath?: string): AppDatabase {
  const target = dbPath || process.env.SQLITE_PATH || './data/meridian.db';
  if (target !== ':memory:') {
    const dir = path.dirname(path.resolve(target));
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  if (target !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrateDatabase(db);
  return db;
}

export function migrateDatabase(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token_hash TEXT,
      reset_token_hash TEXT,
      reset_token_expires_at TEXT,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      mfa_secret_encrypted TEXT,
      mfa_backup_codes_hash TEXT,
      is_platform_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      active_organization_id TEXT,
      mfa_verified INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      country_code TEXT NOT NULL DEFAULT 'US',
      plan_tier TEXT NOT NULL DEFAULT 'STANDARD',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      UNIQUE(organization_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
    CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by_user_id TEXT NOT NULL REFERENCES users(id),
      accepted_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applicant_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      full_legal_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      nationality TEXT NOT NULL,
      residence_country TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      travel_destination TEXT NOT NULL,
      visa_category TEXT NOT NULL,
      intended_travel_start TEXT,
      intended_travel_end TEXT,
      purpose_of_travel TEXT,
      dependents_json TEXT NOT NULL DEFAULT '[]',
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, organization_id)
    );

    CREATE TABLE IF NOT EXISTS passport_records (
      id TEXT PRIMARY KEY,
      applicant_profile_id TEXT NOT NULL UNIQUE REFERENCES applicant_profiles(id) ON DELETE CASCADE,
      passport_number_encrypted TEXT NOT NULL,
      passport_number_masked TEXT NOT NULL,
      issuing_country TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applicant_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      consent_type TEXT NOT NULL,
      granted INTEGER NOT NULL,
      policy_version TEXT NOT NULL DEFAULT '2026-01',
      granted_at TEXT NOT NULL,
      revoked_at TEXT,
      ip_address TEXT
    );

    CREATE TABLE IF NOT EXISTS visa_countries (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS visa_categories (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visa_routes (
      id TEXT PRIMARY KEY,
      destination_country TEXT NOT NULL REFERENCES visa_countries(code),
      visa_category_code TEXT NOT NULL REFERENCES visa_categories(code),
      title TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      is_demo_rule INTEGER NOT NULL DEFAULT 1,
      official_source_url TEXT,
      source_verified_at TEXT,
      effective_from TEXT NOT NULL,
      summary TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visa_applications (
      id TEXT PRIMARY KEY,
      reference_number TEXT NOT NULL UNIQUE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      applicant_user_id TEXT NOT NULL REFERENCES users(id),
      assigned_consultant_id TEXT REFERENCES users(id),
      route_id TEXT REFERENCES visa_routes(id),
      destination_country TEXT NOT NULL REFERENCES visa_countries(code),
      origin_country TEXT NOT NULL,
      nationality TEXT NOT NULL,
      visa_category TEXT NOT NULL REFERENCES visa_categories(code),
      rule_version TEXT NOT NULL,
      internal_status TEXT NOT NULL DEFAULT 'DRAFT',
      government_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      government_status_source TEXT NOT NULL DEFAULT 'UNAVAILABLE',
      government_tracking_ref TEXT,
      intended_travel_date TEXT,
      purpose_of_travel TEXT,
      appointment_at TEXT,
      submission_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_apps_org_status ON visa_applications(organization_id, internal_status);
    CREATE INDEX IF NOT EXISTS idx_apps_applicant ON visa_applications(applicant_user_id);
    CREATE INDEX IF NOT EXISTS idx_apps_consultant ON visa_applications(assigned_consultant_id);

    CREATE TABLE IF NOT EXISTS application_status_history (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by_user_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS case_tasks (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to_user_id TEXT REFERENCES users(id),
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS case_notes (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      author_user_id TEXT NOT NULL REFERENCES users(id),
      visibility TEXT NOT NULL DEFAULT 'INTERNAL',
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      metadata_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organization_id, created_at);

    CREATE TABLE IF NOT EXISTS document_requirements (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requirement_code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      document_type TEXT NOT NULL,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      condition_note TEXT,
      status TEXT NOT NULL DEFAULT 'MISSING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(application_id, requirement_code)
    );

    CREATE INDEX IF NOT EXISTS idx_doc_req_org_app ON document_requirements(organization_id, application_id);

    CREATE TABLE IF NOT EXISTS application_documents (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requirement_code TEXT,
      document_type TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256_checksum TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      storage_provider TEXT NOT NULL DEFAULT 'PRIVATE_LOCAL',
      storage_bucket TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      expiry_date TEXT,
      malware_scan_status TEXT NOT NULL DEFAULT 'PENDING',
      review_status TEXT NOT NULL DEFAULT 'PENDING',
      reviewed_by_user_id TEXT REFERENCES users(id),
      reviewed_at TEXT,
      review_notes TEXT,
      uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_docs_org_app ON application_documents(organization_id, application_id);
    CREATE INDEX IF NOT EXISTS idx_app_docs_checksum ON application_documents(sha256_checksum);

    CREATE TABLE IF NOT EXISTS document_extractions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE REFERENCES application_documents(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      ocr_provider TEXT NOT NULL,
      ai_provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      raw_ocr_text TEXT NOT NULL,
      detected_document_type TEXT NOT NULL,
      extracted_json TEXT NOT NULL,
      corrected_json TEXT,
      confidence_score REAL NOT NULL,
      is_confirmed INTEGER NOT NULL DEFAULT 0,
      confirmed_by_user_id TEXT REFERENCES users(id),
      confirmed_at TEXT,
      ai_disclaimer TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_doc_ext_org_app ON document_extractions(organization_id, application_id);

    CREATE TABLE IF NOT EXISTS document_verifications (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL UNIQUE REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      formatting_status TEXT NOT NULL DEFAULT 'PENDING',
      extraction_status TEXT NOT NULL DEFAULT 'PENDING',
      consistency_status TEXT NOT NULL DEFAULT 'PENDING',
      external_identity_status TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
      manual_officer_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      summary_note TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification_issues (
      id TEXT PRIMARY KEY,
      verification_id TEXT NOT NULL REFERENCES document_verifications(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      source_document_id TEXT REFERENCES application_documents(id) ON DELETE SET NULL,
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      verification_layer TEXT NOT NULL,
      evidence TEXT NOT NULL,
      explanation TEXT NOT NULL,
      suggested_correction TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      resolved_by_user_id TEXT REFERENCES users(id),
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_verif_issues_org_app ON verification_issues(organization_id, application_id);

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      document_id TEXT,
      queue_name TEXT NOT NULL,
      job_name TEXT NOT NULL,
      bullmq_job_id TEXT,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      attempts INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_proc_jobs_org_app ON processing_jobs(organization_id, application_id);

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT,
      application_id TEXT,
      document_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visa_form_schemas (
      id TEXT PRIMARY KEY,
      destination_country TEXT NOT NULL,
      visa_category_code TEXT NOT NULL,
      schema_key TEXT NOT NULL,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      is_demo_rule INTEGER NOT NULL DEFAULT 1,
      official_source_url TEXT,
      schema_json TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'PUBLISHED',
      created_at TEXT NOT NULL,
      UNIQUE(schema_key, version)
    );

    CREATE INDEX IF NOT EXISTS idx_form_schemas_route ON visa_form_schemas(destination_country, visa_category_code);

    CREATE TABLE IF NOT EXISTS application_forms (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL UNIQUE REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      form_schema_id TEXT NOT NULL REFERENCES visa_form_schemas(id),
      schema_version TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 0,
      answers_json TEXT NOT NULL DEFAULT '{}',
      source_attribution_json TEXT NOT NULL DEFAULT '{}',
      ai_suggestions_json TEXT NOT NULL DEFAULT '{}',
      validation_errors_json TEXT NOT NULL DEFAULT '[]',
      is_complete INTEGER NOT NULL DEFAULT 0,
      applicant_approved INTEGER NOT NULL DEFAULT 0,
      applicant_approved_by_user_id TEXT REFERENCES users(id),
      applicant_approved_at TEXT,
      applicant_attestation_text TEXT,
      revision_number INTEGER NOT NULL DEFAULT 1,
      last_autosaved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_forms_org_app ON application_forms(organization_id, application_id);

    CREATE TABLE IF NOT EXISTS application_form_revisions (
      id TEXT PRIMARY KEY,
      application_form_id TEXT NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      revision_number INTEGER NOT NULL,
      answers_json TEXT NOT NULL,
      source_attribution_json TEXT NOT NULL,
      changed_by_user_id TEXT NOT NULL REFERENCES users(id),
      change_reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_form_revisions_form ON application_form_revisions(application_form_id, revision_number);

    CREATE TABLE IF NOT EXISTS submission_handoffs (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      adapter_id TEXT NOT NULL,
      submission_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      handoff_package_json TEXT NOT NULL,
      external_portal_url TEXT,
      external_confirmation_ref TEXT,
      submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
      submitted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sub_handoffs_org_app ON submission_handoffs(organization_id, application_id);

    CREATE TABLE IF NOT EXISTS organization_workflow_stages (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      visa_category TEXT NOT NULL DEFAULT '*',
      stage_code TEXT NOT NULL,
      display_label TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      sla_hours INTEGER NOT NULL DEFAULT 72,
      enabled INTEGER NOT NULL DEFAULT 1,
      allowed_next_stages_json TEXT NOT NULL,
      applicant_allowed INTEGER NOT NULL DEFAULT 0,
      notify_on_enter INTEGER NOT NULL DEFAULT 1,
      updated_by_user_id TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, visa_category, stage_code)
    );

    CREATE INDEX IF NOT EXISTS idx_wf_stages_org ON organization_workflow_stages(organization_id);

    CREATE TABLE IF NOT EXISTS case_appointments (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      appointment_type TEXT NOT NULL,
      center_name TEXT NOT NULL,
      center_address TEXT,
      scheduled_at TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      booking_reference TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      instructions TEXT,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_appts_org_app ON case_appointments(organization_id, application_id);

    CREATE TABLE IF NOT EXISTS status_tracking_events (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      status_category TEXT NOT NULL DEFAULT 'GOVERNMENT_EXTERNAL',
      status_text TEXT NOT NULL,
      source_type TEXT NOT NULL,
      tracking_reference TEXT,
      adapter_id TEXT,
      raw_evidence_note TEXT,
      verified_by_user_id TEXT REFERENCES users(id),
      verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_status_events_org_app ON status_tracking_events(organization_id, application_id, verified_at);

    CREATE TABLE IF NOT EXISTS notification_templates (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL DEFAULT '*',
      template_key TEXT NOT NULL,
      channel TEXT NOT NULL,
      event_trigger TEXT NOT NULL,
      subject_template TEXT,
      body_template TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, template_key, channel)
    );

    CREATE TABLE IF NOT EXISTS notification_jobs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      application_id TEXT REFERENCES visa_applications(id) ON DELETE CASCADE,
      recipient_user_id TEXT REFERENCES users(id),
      recipient_contact TEXT NOT NULL,
      channel TEXT NOT NULL,
      template_key TEXT NOT NULL,
      subject TEXT,
      rendered_body TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_error TEXT,
      bullmq_job_id TEXT,
      dispatched_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notif_jobs_org_status ON notification_jobs(organization_id, status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_notif_jobs_app ON notification_jobs(application_id);
  `);

  const columns = db
    .prepare('PRAGMA table_info(visa_applications)')
    .all() as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));
  if (!colNames.has('purpose_of_travel')) {
    db.exec('ALTER TABLE visa_applications ADD COLUMN purpose_of_travel TEXT;');
  }
  if (!colNames.has('government_status_verified_at')) {
    db.exec('ALTER TABLE visa_applications ADD COLUMN government_status_verified_at TEXT;');
  }
  if (!colNames.has('target_submission_deadline')) {
    db.exec('ALTER TABLE visa_applications ADD COLUMN target_submission_deadline TEXT;');
  }
  if (!colNames.has('stage_due_at')) {
    db.exec('ALTER TABLE visa_applications ADD COLUMN stage_due_at TEXT;');
  }
}

export function writeAuditLog(
  db: AppDatabase,
  params: {
    organizationId?: string | null;
    actorUserId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
  },
): void {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, organization_id, actor_user_id, action, resource_type, resource_id, metadata_json, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    newId('aud'),
    params.organizationId ?? null,
    params.actorUserId ?? null,
    params.action,
    params.resourceType,
    params.resourceId ?? null,
    params.metadata ? JSON.stringify(params.metadata) : null,
    params.ipAddress ?? null,
    new Date().toISOString(),
  );
}
