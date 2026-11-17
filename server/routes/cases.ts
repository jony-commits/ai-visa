import { Router } from 'express';
import { randomToken } from '../crypto.ts';
import { AppDatabase, newId, writeAuditLog } from '../db.ts';
import { requireAuth, requireRoles } from '../middleware.ts';
import {
  GOVERNMENT_STATUS_SOURCES,
  GovernmentStatusSource,
  INTERNAL_CASE_STATUSES,
  InternalCaseStatus,
} from '../types.ts';
import { validateCreateCasePayload } from '../validation.ts';
import {
  canTransitionWithOrgConfig,
  computeStageDueAt,
  getOrgWorkflowStages,
} from '../workflow.ts';
import { scheduleCaseEventNotifications } from '../services/notifications.ts';
import { recordManualVerifiedStatusEvent } from '../services/statusAdapter.ts';

export function createCasesRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/catalog/routes', requireAuth, (req, res) => {
    const countries = db
      .prepare('SELECT code, name, region FROM visa_countries WHERE enabled = 1 ORDER BY name ASC')
      .all();
    const categories = db
      .prepare('SELECT code, name, description FROM visa_categories ORDER BY name ASC')
      .all();
    const routes = db
      .prepare(
        `
        SELECT r.*, c.name AS country_name, cat.name AS category_name
        FROM visa_routes r
        JOIN visa_countries c ON c.code = r.destination_country
        JOIN visa_categories cat ON cat.code = r.visa_category_code
        WHERE r.approval_status = 'PUBLISHED'
          AND (r.organization_id IS NULL OR r.organization_id = ?)
        ORDER BY CASE WHEN r.organization_id = ? THEN 0 ELSE 1 END, r.title ASC
      `,
      )
      .all(req.auth!.organizationId, req.auth!.organizationId);

    res.json({ countries, categories, routes });
  });

  router.get('/cases', requireAuth, (req, res) => {
    const { status, category, country, assigned, search } = req.query as {
      status?: string;
      category?: string;
      country?: string;
      assigned?: string;
      search?: string;
    };

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!req.auth!.isPlatformAdmin) {
      conditions.push('a.organization_id = ?');
      params.push(req.auth!.organizationId);
    }

    if (req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin) {
      conditions.push('a.applicant_user_id = ?');
      params.push(req.auth!.userId);
    }

    if (status && status !== 'ALL') {
      conditions.push('a.internal_status = ?');
      params.push(status);
    }

    if (category && category !== 'ALL') {
      conditions.push('a.visa_category = ?');
      params.push(category);
    }

    if (country && country !== 'ALL') {
      conditions.push('a.destination_country = ?');
      params.push(country);
    }

    if (assigned === 'UNASSIGNED') {
      conditions.push('a.assigned_consultant_id IS NULL');
    } else if (assigned === 'MINE') {
      conditions.push('a.assigned_consultant_id = ?');
      params.push(req.auth!.userId);
    }

    if (search?.trim()) {
      conditions.push(
        '(LOWER(a.reference_number) LIKE ? OR LOWER(u_app.full_name) LIKE ? OR LOWER(a.destination_country) LIKE ?)',
      );
      const q = `%${search.trim().toLowerCase()}%`;
      params.push(q, q, q);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `
        SELECT
          a.*,
          u_app.full_name AS applicant_name,
          u_app.email AS applicant_email,
          u_con.full_name AS consultant_name,
          COALESCE(r.title, c.name || ' ' || cat.name) AS route_title,
          COALESCE(r.is_demo_rule, 1) AS is_demo_rule,
          c.name AS destination_country_name,
          cat.name AS visa_category_name,
          o.name AS organization_name
        FROM visa_applications a
        JOIN users u_app ON u_app.id = a.applicant_user_id
        LEFT JOIN users u_con ON u_con.id = a.assigned_consultant_id
        LEFT JOIN visa_routes r ON r.id = a.route_id
        LEFT JOIN visa_countries c ON c.code = a.destination_country
        LEFT JOIN visa_categories cat ON cat.code = a.visa_category
        JOIN organizations o ON o.id = a.organization_id
        ${whereSql}
        ORDER BY a.updated_at DESC
      `,
      )
      .all(...params);

    res.json({ cases: rows });
  });

  router.post('/cases', requireAuth, (req, res) => {
    const validation = validateCreateCasePayload(
      db,
      (req.body || {}) as Record<string, unknown>,
    );
    if (validation.valid === false) {
      res.status(400).json({
        error: validation.error,
        fieldErrors: validation.fieldErrors,
      });
      return;
    }

    const {
      destinationCountry,
      visaCategory,
      routeId,
      originCountry,
      nationality,
      intendedTravelDate,
      purposeOfTravel,
      submissionNotes,
      applicantUserId,
      assignedConsultantId,
    } = validation.value;

    // Applicants can only create cases for themselves
    let targetApplicantId = req.auth!.userId;
    if (applicantUserId && applicantUserId !== req.auth!.userId) {
      if (req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin) {
        res.status(403).json({
          error: 'Forbidden: applicants cannot create cases for another user',
        });
        return;
      }
      const applicantInOrg = db
        .prepare(
          'SELECT user_id FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = \'ACTIVE\'',
        )
        .get(req.auth!.organizationId, applicantUserId) as { user_id: string } | undefined;
      if (!applicantInOrg) {
        res.status(403).json({ error: 'Selected applicant does not belong to your organization' });
        return;
      }
      targetApplicantId = applicantInOrg.user_id;
    }

    // Resolve matching published route (explicit routeId or org/global published route for country + category)
    let matchedRoute = routeId
      ? (db
          .prepare(
            "SELECT * FROM visa_routes WHERE id = ? AND approval_status = 'PUBLISHED' AND (organization_id IS NULL OR organization_id = ?)",
          )
          .get(routeId, req.auth!.organizationId) as Record<string, unknown> | undefined)
      : (db
          .prepare(
            `
            SELECT * FROM visa_routes
            WHERE destination_country = ? AND visa_category_code = ?
              AND approval_status = 'PUBLISHED'
              AND (organization_id IS NULL OR organization_id = ?)
            ORDER BY CASE WHEN organization_id = ? THEN 0 ELSE 1 END, COALESCE(approved_at, effective_from) DESC
            LIMIT 1
          `,
          )
          .get(
            destinationCountry,
            visaCategory,
            req.auth!.organizationId,
            req.auth!.organizationId,
          ) as Record<string, unknown> | undefined);

    // Resolve consultant assignment on creation
    let resolvedConsultantId: string | null = null;
    if (assignedConsultantId) {
      if (req.auth!.role !== 'AGENCY_ADMIN' && !req.auth!.isPlatformAdmin) {
        res.status(403).json({
          error: 'Forbidden: only Agency Administrators can assign consultants at case creation',
        });
        return;
      }
      const staffMember = db
        .prepare(
          `
          SELECT user_id FROM organization_members
          WHERE organization_id = ? AND user_id = ? AND status = 'ACTIVE'
            AND role IN ('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER')
        `,
        )
        .get(req.auth!.organizationId, assignedConsultantId) as { user_id: string } | undefined;
      if (!staffMember) {
        res.status(400).json({
          error: 'Assigned consultant must be an active staff member within the same organization',
        });
        return;
      }
      resolvedConsultantId = staffMember.user_id;
    } else if (req.auth!.role === 'CONSULTANT') {
      resolvedConsultantId = req.auth!.userId;
    }

    const now = new Date().toISOString();
    const caseId = newId('app');
    const year = new Date().getUTCFullYear();
    const referenceNumber = `MRD-${year}-${randomToken(3).toUpperCase()}`;
    const initialStatus: InternalCaseStatus = 'APPLICANT_INFO_PENDING';
    const stageConfigs = getOrgWorkflowStages(db, req.auth!.organizationId, visaCategory);
    const initStageConfig = stageConfigs.find((s) => s.stageCode === initialStatus);
    const initialStageDueAt = initStageConfig
      ? computeStageDueAt(initStageConfig.slaHours)
      : computeStageDueAt(72);
    const ruleVersion = matchedRoute
      ? String(matchedRoute.rule_version)
      : 'unconfigured-intake-v1';

    db.prepare(`
      INSERT INTO visa_applications (
        id, reference_number, organization_id, applicant_user_id, assigned_consultant_id,
        route_id, destination_country, origin_country, nationality, visa_category,
        rule_version, internal_status, government_status, government_status_source,
        intended_travel_date, purpose_of_travel, submission_notes, stage_due_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_SUBMITTED', 'UNAVAILABLE', ?, ?, ?, ?, ?, ?)
    `).run(
      caseId,
      referenceNumber,
      req.auth!.organizationId,
      targetApplicantId,
      resolvedConsultantId,
      matchedRoute ? String(matchedRoute.id) : null,
      destinationCountry,
      originCountry,
      nationality,
      visaCategory,
      ruleVersion,
      initialStatus,
      intendedTravelDate,
      purposeOfTravel,
      submissionNotes,
      initialStageDueAt,
      now,
      now,
    );

    db.prepare(`
      INSERT INTO application_status_history (
        id, application_id, organization_id, from_status, to_status, changed_by_user_id, reason, created_at
      ) VALUES (?, ?, ?, NULL, ?, ?, 'Case initialized', ?)
    `).run(newId('hist'), caseId, req.auth!.organizationId, initialStatus, req.auth!.userId, now);

    writeAuditLog(db, {
      organizationId: req.auth!.organizationId,
      actorUserId: req.auth!.userId,
      action: 'CASE_CREATED',
      resourceType: 'VisaApplication',
      resourceId: caseId,
      metadata: {
        referenceNumber,
        destinationCountry,
        visaCategory,
        routeId: matchedRoute ? matchedRoute.id : null,
        applicantUserId: targetApplicantId,
        assignedConsultantId: resolvedConsultantId,
      },
      ipAddress: req.ip,
    });

    const created = db.prepare('SELECT * FROM visa_applications WHERE id = ?').get(caseId);
    res.status(201).json({ application: created });
  });

  router.get('/cases/:id', requireAuth, (req, res) => {
    const appRow = db
      .prepare(
        `
        SELECT
          a.*,
          u_app.full_name AS applicant_name,
          u_app.email AS applicant_email,
          u_con.full_name AS consultant_name,
          COALESCE(r.title, c.name || ' — ' || cat.name) AS route_title,
          COALESCE(r.is_demo_rule, 1) AS is_demo_rule,
          r.official_source_url,
          r.source_verified_at,
          c.name AS destination_country_name,
          cat.name AS visa_category_name
        FROM visa_applications a
        JOIN users u_app ON u_app.id = a.applicant_user_id
        LEFT JOIN users u_con ON u_con.id = a.assigned_consultant_id
        LEFT JOIN visa_routes r ON r.id = a.route_id
        LEFT JOIN visa_countries c ON c.code = a.destination_country
        LEFT JOIN visa_categories cat ON cat.code = a.visa_category
        WHERE a.id = ?
      `,
      )
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!appRow) {
      res.status(404).json({ error: 'Visa application not found' });
      return;
    }

    if (!req.auth!.isPlatformAdmin && String(appRow.organization_id) !== req.auth!.organizationId) {
      res.status(403).json({ error: 'Forbidden: cross-tenant access denied' });
      return;
    }

    if (
      req.auth!.role === 'APPLICANT' &&
      !req.auth!.isPlatformAdmin &&
      String(appRow.applicant_user_id) !== req.auth!.userId
    ) {
      res.status(403).json({ error: 'Forbidden: applicants can only access their own cases' });
      return;
    }

    const history = db
      .prepare(
        `
        SELECT h.*, u.full_name AS changed_by_name
        FROM application_status_history h
        JOIN users u ON u.id = h.changed_by_user_id
        WHERE h.application_id = ? AND h.organization_id = ?
        ORDER BY h.created_at DESC
      `,
      )
      .all(req.params.id, String(appRow.organization_id));

    const tasks = db
      .prepare(
        `
        SELECT t.*, u.full_name AS assigned_to_name
        FROM case_tasks t
        LEFT JOIN users u ON u.id = t.assigned_to_user_id
        WHERE t.application_id = ? AND t.organization_id = ?
        ORDER BY t.created_at DESC
      `,
      )
      .all(req.params.id, String(appRow.organization_id));

    const isApplicant = req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin;
    const notes = isApplicant
      ? db
          .prepare(
            `
            SELECT n.*, u.full_name AS author_name
            FROM case_notes n
            JOIN users u ON u.id = n.author_user_id
            WHERE n.application_id = ? AND n.organization_id = ? AND n.visibility = 'APPLICANT_VISIBLE'
            ORDER BY n.created_at DESC
          `,
          )
          .all(req.params.id, String(appRow.organization_id))
      : db
          .prepare(
            `
            SELECT n.*, u.full_name AS author_name
            FROM case_notes n
            JOIN users u ON u.id = n.author_user_id
            WHERE n.application_id = ? AND n.organization_id = ?
            ORDER BY n.created_at DESC
          `,
          )
          .all(req.params.id, String(appRow.organization_id));

    const applicantProfile = db
      .prepare(
        `
        SELECT p.full_legal_name, p.date_of_birth, p.nationality, p.residence_country, p.phone,
               p.dependents_json, p.onboarding_completed,
               pr.passport_number_masked, pr.issuing_country, pr.expiry_date
        FROM applicant_profiles p
        LEFT JOIN passport_records pr ON pr.applicant_profile_id = p.id
        WHERE p.user_id = ? AND p.organization_id = ?
      `,
      )
      .get(String(appRow.applicant_user_id), String(appRow.organization_id)) as
      | Record<string, unknown>
      | undefined;

    const currentStatus = String(appRow.internal_status) as InternalCaseStatus;
    const stageConfigs = getOrgWorkflowStages(
      db,
      String(appRow.organization_id),
      String(appRow.visa_category),
    );
    const currentStageCfg = stageConfigs.find((s) => s.stageCode === currentStatus);
    const candidateTargets = currentStageCfg
      ? currentStageCfg.allowedNextStages
      : INTERNAL_CASE_STATUSES;
    const availableTransitions = candidateTargets.filter(
      (target) =>
        canTransitionWithOrgConfig(
          db,
          String(appRow.organization_id),
          String(appRow.visa_category),
          currentStatus,
          target,
          req.auth!.role,
          req.auth!.isPlatformAdmin,
        ).allowed,
    );

    res.json({
      application: appRow,
      applicantProfile: applicantProfile
        ? {
            ...applicantProfile,
            dependents: JSON.parse(String(applicantProfile.dependents_json || '[]')),
          }
        : null,
      history,
      tasks,
      notes,
      availableTransitions,
      stageConfigs,
    });
  });

  router.patch(
    '/cases/:id/assign',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const { consultantUserId } = req.body as { consultantUserId?: string | null };

      const appRow = db
        .prepare('SELECT id, organization_id FROM visa_applications WHERE id = ?')
        .get(req.params.id) as { id: string; organization_id: string } | undefined;

      if (!appRow) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      if (!req.auth!.isPlatformAdmin && appRow.organization_id !== req.auth!.organizationId) {
        res.status(403).json({ error: 'Forbidden: cross-tenant case assignment denied' });
        return;
      }

      if (consultantUserId === null || consultantUserId === '') {
        db.prepare(
          'UPDATE visa_applications SET assigned_consultant_id = NULL, updated_at = ? WHERE id = ?',
        ).run(new Date().toISOString(), appRow.id);

        writeAuditLog(db, {
          organizationId: appRow.organization_id,
          actorUserId: req.auth!.userId,
          action: 'CASE_UNASSIGNED',
          resourceType: 'VisaApplication',
          resourceId: appRow.id,
          ipAddress: req.ip,
        });

        res.json({ assigned: false, consultantUserId: null });
        return;
      }

      if (!consultantUserId) {
        res.status(400).json({ error: 'consultantUserId is required' });
        return;
      }

      const member = db
        .prepare(
          `
          SELECT user_id, role FROM organization_members
          WHERE organization_id = ? AND user_id = ? AND status = 'ACTIVE'
            AND role IN ('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER')
        `,
        )
        .get(appRow.organization_id, consultantUserId) as
        | { user_id: string; role: string }
        | undefined;

      if (!member) {
        res.status(400).json({
          error: 'Assignee must be an active consultant or staff member within the same organization',
        });
        return;
      }

      db.prepare(
        'UPDATE visa_applications SET assigned_consultant_id = ?, updated_at = ? WHERE id = ?',
      ).run(consultantUserId, new Date().toISOString(), appRow.id);

      writeAuditLog(db, {
        organizationId: appRow.organization_id,
        actorUserId: req.auth!.userId,
        action: 'CASE_ASSIGNED',
        resourceType: 'VisaApplication',
        resourceId: appRow.id,
        metadata: { assignedConsultantId: consultantUserId },
        ipAddress: req.ip,
      });

      const notifications = scheduleCaseEventNotifications(db, {
        applicationId: appRow.id,
        organizationId: appRow.organization_id,
        templateKey: 'CONSULTANT_ASSIGNED',
        variables: {},
        includeConsultant: true,
        actorUserId: req.auth!.userId,
      });

      res.json({ assigned: true, consultantUserId, notifications });
    },
  );

  router.patch('/cases/:id/transition', requireAuth, (req, res) => {
    const { toStatus, reason } = req.body as {
      toStatus?: InternalCaseStatus;
      reason?: string;
    };
    if (!toStatus || !INTERNAL_CASE_STATUSES.includes(toStatus)) {
      res.status(400).json({ error: 'Valid target workflow status is required' });
      return;
    }

    const appRow = db
      .prepare('SELECT * FROM visa_applications WHERE id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!appRow) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    if (!req.auth!.isPlatformAdmin && String(appRow.organization_id) !== req.auth!.organizationId) {
      res.status(403).json({ error: 'Forbidden: cross-tenant transition denied' });
      return;
    }

    if (
      req.auth!.role === 'APPLICANT' &&
      !req.auth!.isPlatformAdmin &&
      String(appRow.applicant_user_id) !== req.auth!.userId
    ) {
      res.status(403).json({ error: 'Forbidden: cannot modify another applicant case' });
      return;
    }

    const fromStatus = String(appRow.internal_status) as InternalCaseStatus;
    const check = canTransitionWithOrgConfig(
      db,
      String(appRow.organization_id),
      String(appRow.visa_category),
      fromStatus,
      toStatus,
      req.auth!.role,
      req.auth!.isPlatformAdmin,
    );
    if (!check.allowed) {
      res.status(400).json({ error: check.reason });
      return;
    }

    const now = new Date().toISOString();
    const nextStageDueAt = check.targetStage
      ? computeStageDueAt(check.targetStage.slaHours)
      : null;

    db.prepare(
      'UPDATE visa_applications SET internal_status = ?, stage_due_at = ?, updated_at = ? WHERE id = ?',
    ).run(toStatus, nextStageDueAt, now, String(appRow.id));

    db.prepare(`
      INSERT INTO application_status_history (
        id, application_id, organization_id, from_status, to_status, changed_by_user_id, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('hist'),
      String(appRow.id),
      String(appRow.organization_id),
      fromStatus,
      toStatus,
      req.auth!.userId,
      reason?.trim() || null,
      now,
    );

    writeAuditLog(db, {
      organizationId: String(appRow.organization_id),
      actorUserId: req.auth!.userId,
      action: 'CASE_STATUS_TRANSITIONED',
      resourceType: 'VisaApplication',
      resourceId: String(appRow.id),
      metadata: { fromStatus, toStatus, reason, stageDueAt: nextStageDueAt },
      ipAddress: req.ip,
    });

    const notifications =
      check.targetStage?.notifyOnEnter !== false
        ? scheduleCaseEventNotifications(db, {
            applicationId: String(appRow.id),
            organizationId: String(appRow.organization_id),
            templateKey: 'CASE_STAGE_CHANGED',
            variables: {
              stageLabel: check.targetStage?.displayLabel || toStatus,
              stageDueAt: nextStageDueAt || 'Unset',
            },
            includeConsultant: true,
            actorUserId: req.auth!.userId,
          })
        : [];

    res.json({ updated: true, fromStatus, toStatus, stageDueAt: nextStageDueAt, notifications });
  });

  router.patch(
    '/cases/:id/government-status',
    requireAuth,
    requireRoles('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      const { governmentStatus, governmentStatusSource, governmentTrackingRef } = req.body as {
        governmentStatus?: string;
        governmentStatusSource?: GovernmentStatusSource;
        governmentTrackingRef?: string;
      };

      if (
        !governmentStatus?.trim() ||
        !governmentStatusSource ||
        !GOVERNMENT_STATUS_SOURCES.includes(governmentStatusSource)
      ) {
        res.status(400).json({ error: 'Valid governmentStatus and verified source are required' });
        return;
      }

      if (governmentStatusSource === 'OFFICIAL_API') {
        res.status(400).json({
          error:
            'OFFICIAL_API source can only be written by an authorized government API integration adapter, not manual entry.',
        });
        return;
      }

      const appRow = db
        .prepare('SELECT id, organization_id FROM visa_applications WHERE id = ?')
        .get(req.params.id) as { id: string; organization_id: string } | undefined;

      if (!appRow) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      if (!req.auth!.isPlatformAdmin && appRow.organization_id !== req.auth!.organizationId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      try {
        const event = recordManualVerifiedStatusEvent(db, {
          applicationId: appRow.id,
          organizationId: appRow.organization_id,
          actorUserId: req.auth!.userId,
          statusText: governmentStatus,
          sourceType: governmentStatusSource,
          trackingReference: governmentTrackingRef,
          rawEvidenceNote: 'Recorded via case header official status update',
          ipAddress: req.ip,
        });

        res.json({ updated: true, event });
      } catch (err: any) {
        res.status(err.statusCode || 400).json({ error: err.message });
      }
    },
  );

  router.post(
    '/cases/:id/tasks',
    requireAuth,
    requireRoles('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      const { title, description, assignedToUserId, dueAt } = req.body as {
        title?: string;
        description?: string;
        assignedToUserId?: string;
        dueAt?: string;
      };
      if (!title?.trim()) {
        res.status(400).json({ error: 'Task title is required' });
        return;
      }

      const appRow = db
        .prepare('SELECT id, organization_id FROM visa_applications WHERE id = ?')
        .get(req.params.id) as { id: string; organization_id: string } | undefined;

      if (!appRow) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      if (!req.auth!.isPlatformAdmin && appRow.organization_id !== req.auth!.organizationId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const now = new Date().toISOString();
      const id = newId('tsk');
      db.prepare(`
        INSERT INTO case_tasks (
          id, application_id, organization_id, title, description, assigned_to_user_id, due_at, status, created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)
      `).run(
        id,
        appRow.id,
        appRow.organization_id,
        title.trim(),
        description?.trim() || null,
        assignedToUserId || null,
        dueAt || null,
        req.auth!.userId,
        now,
        now,
      );

      res.status(201).json({ taskId: id });
    },
  );

  router.patch('/cases/:id/tasks/:taskId', requireAuth, (req, res) => {
    const { status } = req.body as { status?: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' };
    if (!status || !['OPEN', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
      res.status(400).json({ error: 'Valid task status required' });
      return;
    }

    const task = db
      .prepare('SELECT * FROM case_tasks WHERE id = ? AND application_id = ?')
      .get(req.params.taskId, req.params.id) as Record<string, unknown> | undefined;

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (!req.auth!.isPlatformAdmin && String(task.organization_id) !== req.auth!.organizationId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin) {
      const appRow = db
        .prepare('SELECT applicant_user_id FROM visa_applications WHERE id = ?')
        .get(req.params.id) as { applicant_user_id: string } | undefined;
      if (!appRow || appRow.applicant_user_id !== req.auth!.userId) {
        res.status(403).json({ error: 'Forbidden: cannot modify task on another applicant case' });
        return;
      }
    }

    db.prepare('UPDATE case_tasks SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      new Date().toISOString(),
      String(task.id),
    );
    res.json({ updated: true, status });
  });

  router.post('/cases/:id/notes', requireAuth, (req, res) => {
    const { body, visibility = 'INTERNAL' } = req.body as {
      body?: string;
      visibility?: 'INTERNAL' | 'APPLICANT_VISIBLE';
    };
    if (!body?.trim()) {
      res.status(400).json({ error: 'Note text is required' });
      return;
    }

    const appRow = db
      .prepare('SELECT id, organization_id, applicant_user_id FROM visa_applications WHERE id = ?')
      .get(req.params.id) as
      | { id: string; organization_id: string; applicant_user_id: string }
      | undefined;

    if (!appRow) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (!req.auth!.isPlatformAdmin && appRow.organization_id !== req.auth!.organizationId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (
      req.auth!.role === 'APPLICANT' &&
      !req.auth!.isPlatformAdmin &&
      appRow.applicant_user_id !== req.auth!.userId
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const effectiveVisibility =
      req.auth!.role === 'APPLICANT' ? 'APPLICANT_VISIBLE' : visibility;

    const id = newId('note');
    db.prepare(`
      INSERT INTO case_notes (id, application_id, organization_id, author_user_id, visibility, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      appRow.id,
      appRow.organization_id,
      req.auth!.userId,
      effectiveVisibility,
      body.trim(),
      new Date().toISOString(),
    );

    res.status(201).json({ noteId: id, visibility: effectiveVisibility });
  });

  return router;
}
