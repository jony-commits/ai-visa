# Database Design — Meridian Visa Platform

## 1. Overview
The data model is normalized, multi-tenant, and designed in both `prisma/schema.prisma` (target PostgreSQL production schema) and `server/db.ts` (executable SQLite relational schema for local zero-setup development).

## 2. Multi-Tenant Isolation Strategy
- Every organization-owned entity (`organization_members`, `invitations`, `visa_applications`, `case_tasks`, `case_notes`, `audit_logs`, and Phase 2+ documents/forms/notifications) carries `organization_id`.
- Queries for non-Super-Admin users always include `WHERE organization_id = ?`.
- Applicants are additionally scoped via `applicant_user_id = ?` so they can never view other applicants' cases within the same agency.

## 3. Phase 1 Entities

### Identity & Access
- `users`: `id`, `email` (unique), `password_hash`, `full_name`, `email_verified`, `verification_token_hash`, `reset_token_hash`, `reset_token_expires_at`, `mfa_enabled`, `mfa_secret_encrypted`, `mfa_backup_codes_hash`, `is_platform_admin`, `created_at`, `updated_at`.
- `sessions`: `id`, `user_id`, `token_hash`, `active_organization_id`, `mfa_verified`, `expires_at`, `revoked_at`, `ip_address`, `user_agent`, `created_at`.
- `organizations`: `id`, `name`, `slug` (unique), `country_code`, `plan_tier`, `status` (`ACTIVE` | `SUSPENDED` | `PENDING`), `created_at`, `updated_at`.
- `organization_members`: `id`, `organization_id`, `user_id`, `role` (`APPLICANT` | `CONSULTANT` | `VERIFICATION_OFFICER` | `AGENCY_ADMIN`), `status`, `created_at`. Unique `(organization_id, user_id)`.
- `invitations`: `id`, `organization_id`, `email`, `role`, `token_hash`, `invited_by_user_id`, `accepted_at`, `expires_at`, `created_at`.

### Applicant Onboarding & Sensitive Records
- `applicant_profiles`: `id`, `user_id`, `organization_id`, `full_legal_name`, `date_of_birth`, `nationality`, `residence_country`, `phone`, `email`, `travel_destination`, `visa_category`, `intended_travel_start`, `intended_travel_end`, `purpose_of_travel`, `dependents_json`, `onboarding_completed`, `updated_at`.
- `passport_records`: `id`, `applicant_profile_id`, `passport_number_encrypted`, `passport_number_masked`, `issuing_country`, `issue_date`, `expiry_date`, `created_at`, `updated_at`.
- `applicant_consents`: `id`, `user_id`, `organization_id`, `consent_type` (`PERSONAL_DATA_PROCESSING` | `EXTERNAL_AI_PROCESSING` | `COMMUNICATIONS`), `granted`, `policy_version`, `granted_at`, `revoked_at`, `ip_address`.

### Visa Catalog & Case Management
- `visa_countries`: `code` (PK), `name`, `region`, `enabled`.
- `visa_categories`: `code` (PK), `name`, `description`.
- `visa_routes`: `id`, `destination_country`, `visa_category_code`, `title`, `rule_version`, `is_demo_rule`, `official_source_url`, `source_verified_at`, `effective_from`, `summary`.
- `visa_applications`: `id`, `reference_number` (unique), `organization_id`, `applicant_user_id`, `assigned_consultant_id`, `route_id`, `destination_country`, `origin_country`, `nationality`, `visa_category`, `rule_version`, `internal_status`, `government_status`, `government_status_source`, `government_tracking_ref`, `intended_travel_date`, `appointment_at`, `submission_notes`, `created_at`, `updated_at`.
- `application_status_history`: `id`, `application_id`, `organization_id`, `from_status`, `to_status`, `changed_by_user_id`, `reason`, `created_at`.
- `case_tasks`: `id`, `application_id`, `organization_id`, `title`, `description`, `assigned_to_user_id`, `due_at`, `status` (`OPEN` | `IN_PROGRESS` | `COMPLETED`), `created_by_user_id`, `created_at`, `updated_at`.
- `case_notes`: `id`, `application_id`, `organization_id`, `author_user_id`, `visibility` (`INTERNAL` | `APPLICANT_VISIBLE`), `body`, `created_at`.
- `audit_logs`: `id`, `organization_id`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `metadata_json`, `ip_address`, `created_at`.

## 4. Planned Entities (Phases 2–6 in `prisma/schema.prisma`)
`visa_rule_sets`, `visa_rule_versions`, `document_requirements`, `application_documents`, `document_extractions`, `document_verifications`, `verification_issues`, `form_templates`, `form_template_versions`, `form_submission_drafts`, `form_answers`, `review_approvals`, `visa_appointments`, `submission_records`, `external_tracking_references`, `external_status_events`, `notifications`, `workflow_definitions`, `workflow_executions`, `integration_connections`, `ai_usage_logs`.
