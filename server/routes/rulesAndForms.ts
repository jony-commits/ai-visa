import { Router } from 'express';
import { AppDatabase, newId, writeAuditLog } from '../db.ts';
import { requireAuth, requireRoles } from '../middleware.ts';
import {
  FormStepDefinition,
  JsonSchemaFieldSpec,
  resolveFormSchemaForCase,
  seedFormSchemas,
  VisaFormJsonSchema,
} from '../services/formSchemas.ts';
import {
  evaluateCountryVisaRuleEngine,
  RequirementTemplate,
  RuleConditionType,
} from '../services/verification.ts';

type ApprovalStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'ARCHIVED';

const ALLOWED_RULE_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['PUBLISHED', 'DRAFT', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
};

const VALID_CONDITIONS: RuleConditionType[] = [
  'ALWAYS',
  'HAS_DEPENDENTS',
  'STAY_OVER_30_DAYS',
];

function sanitizeRequirements(input: unknown): {
  valid: true;
  items: RequirementTemplate[];
} | { valid: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { valid: false, error: 'At least one checklist requirement rule is required.' };
  }

  const seenCodes = new Set<string>();
  const items: RequirementTemplate[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      return { valid: false, error: 'Each checklist requirement must be an object.' };
    }
    const r = raw as Record<string, unknown>;
    const code = String(r.requirementCode || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');
    const title = String(r.title || '').trim();
    const description = String(r.description || '').trim();
    const documentType = String(r.documentType || 'OTHER')
      .trim()
      .toUpperCase();
    const conditionType = String(r.conditionType || 'ALWAYS').toUpperCase() as RuleConditionType;

    if (!code || code.length < 3) {
      return { valid: false, error: 'Each requirement requires a valid requirementCode (min 3 chars).' };
    }
    if (seenCodes.has(code)) {
      return { valid: false, error: `Duplicate requirementCode "${code}".` };
    }
    seenCodes.add(code);

    if (!title || title.length < 3) {
      return { valid: false, error: `Requirement ${code} requires a clear title.` };
    }
    if (!VALID_CONDITIONS.includes(conditionType)) {
      return { valid: false, error: `Invalid conditionType "${conditionType}" on ${code}.` };
    }

    items.push({
      requirementCode: code,
      title,
      description: description || `${title} supporting document.`,
      documentType,
      isMandatory: r.isMandatory !== false,
      conditionNote: String(r.conditionNote || '').trim() || `Rule condition: ${conditionType}`,
      conditionType,
    });
  }

  return { valid: true, items };
}

function sanitizeFormSchemaSpec(params: {
  schemaKey: string;
  version: string;
  title: string;
  destinationCountry: string;
  visaCategoryCode: string;
  isDemoRule: boolean;
  officialSourceUrl: string | null;
  steps: unknown;
  properties: unknown;
}): { valid: true; schema: VisaFormJsonSchema } | { valid: false; error: string } {
  const schemaKey = params.schemaKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-');
  const version = params.version.trim();
  const title = params.title.trim();

  if (!schemaKey || schemaKey.length < 3) {
    return { valid: false, error: 'schemaKey must be at least 3 characters.' };
  }
  if (!version) {
    return { valid: false, error: 'version is required (e.g., 2026.2-custom).' };
  }
  if (!title || title.length < 4) {
    return { valid: false, error: 'Form schema title is required.' };
  }
  if (!Array.isArray(params.steps) || params.steps.length === 0) {
    return { valid: false, error: 'At least one form wizard step is required.' };
  }

  const steps: FormStepDefinition[] = [];
  const stepIds = new Set<string>();
  params.steps.forEach((rawStep, idx) => {
    const s = (rawStep || {}) as Record<string, unknown>;
    const id = String(s.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const stepTitle = String(s.title || '').trim();
    if (!id || !stepTitle) return;
    if (!stepIds.has(id)) {
      stepIds.add(id);
      steps.push({
        id,
        title: stepTitle,
        description: String(s.description || '').trim() || `${stepTitle} details.`,
        order: idx,
      });
    }
  });

  if (steps.length === 0) {
    return { valid: false, error: 'Each step must have a valid id and title.' };
  }

  if (!params.properties || typeof params.properties !== 'object' || Array.isArray(params.properties)) {
    return { valid: false, error: 'Form properties map is required.' };
  }

  const cleanProps: Record<string, JsonSchemaFieldSpec> = {};
  const requiredKeys: string[] = [];

  for (const [rawKey, rawSpec] of Object.entries(params.properties as Record<string, unknown>)) {
    const key = rawKey.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!key || !rawSpec || typeof rawSpec !== 'object') continue;
    const spec = rawSpec as Record<string, unknown>;
    const type = String(spec.type || 'string');
    if (!['string', 'number', 'boolean', 'date'].includes(type)) {
      return { valid: false, error: `Unsupported field type "${type}" on field "${key}".` };
    }
    const fieldTitle = String(spec.title || '').trim();
    if (!fieldTitle) {
      return { valid: false, error: `Field "${key}" requires a display title.` };
    }
    const stepId = stepIds.has(String(spec.stepId || ''))
      ? String(spec.stepId)
      : steps[0].id;
    const isRequired = Boolean(spec.required);
    if (isRequired) requiredKeys.push(key);

    const fieldSpec: JsonSchemaFieldSpec = {
      type: type as JsonSchemaFieldSpec['type'],
      title: fieldTitle,
      stepId,
      required: isRequired,
    };

    if (spec.description) fieldSpec.description = String(spec.description).trim();
    if (spec.placeholder) fieldSpec.placeholder = String(spec.placeholder).trim();
    if (spec.format && ['textarea', 'country', 'currency', 'email'].includes(String(spec.format))) {
      fieldSpec.format = String(spec.format) as JsonSchemaFieldSpec['format'];
    }
    if (typeof spec.minLength === 'number' && spec.minLength > 0) {
      fieldSpec.minLength = spec.minLength;
    }
    if (typeof spec.maxLength === 'number' && spec.maxLength > 0) {
      fieldSpec.maxLength = spec.maxLength;
    }
    if (Array.isArray(spec.enum) && spec.enum.length > 0) {
      fieldSpec.enum = spec.enum
        .filter((o: any) => o && String(o.value || '').trim() && String(o.label || '').trim())
        .map((o: any) => ({ value: String(o.value).trim(), label: String(o.label).trim() }));
    }
    if (spec.visibleWhen && typeof spec.visibleWhen === 'object') {
      const vw = spec.visibleWhen as Record<string, unknown>;
      if (String(vw.field || '').trim()) {
        fieldSpec.visibleWhen = {
          field: String(vw.field).trim(),
          ...(vw.equals !== undefined ? { equals: vw.equals as any } : {}),
          ...(Array.isArray(vw.in) ? { in: vw.in as any } : {}),
          ...(vw.truthy ? { truthy: true } : {}),
        };
      }
    }
    if (spec.requiredWhen && typeof spec.requiredWhen === 'object') {
      const rw = spec.requiredWhen as Record<string, unknown>;
      if (String(rw.field || '').trim()) {
        fieldSpec.requiredWhen = {
          field: String(rw.field).trim(),
          ...(rw.equals !== undefined ? { equals: rw.equals as any } : {}),
          ...(Array.isArray(rw.in) ? { in: rw.in as any } : {}),
          ...(rw.truthy ? { truthy: true } : {}),
        };
      }
    }
    if (spec.aiSuggestible) fieldSpec.aiSuggestible = true;
    if (spec.sensitiveMasked) fieldSpec.sensitiveMasked = true;

    cleanProps[key] = fieldSpec;
  }

  if (Object.keys(cleanProps).length === 0) {
    return { valid: false, error: 'At least one valid form field is required.' };
  }

  return {
    valid: true,
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      schemaKey,
      version,
      title,
      destinationCountry: params.destinationCountry,
      visaCategoryCode: params.visaCategoryCode,
      isDemoRule: params.isDemoRule,
      officialSourceUrl: params.officialSourceUrl,
      steps,
      properties: cleanProps,
      required: requiredKeys,
    },
  };
}

function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function createRulesAndFormsRouter(db: AppDatabase): Router {
  const router = Router();

  // 1. List Country Visa Rules (visible to tenant/role)
  router.get('/rules/routes', requireAuth, (req, res) => {
    const isApplicant = req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin;
    const requestedPlatformScope = req.query.scope === 'platform' && req.auth!.isPlatformAdmin;

    const rows = requestedPlatformScope
      ? db
          .prepare(
            `
            SELECT r.*, c.name AS country_name, cat.name AS category_name, o.name AS organization_name
            FROM visa_routes r
            JOIN visa_countries c ON c.code = r.destination_country
            JOIN visa_categories cat ON cat.code = r.visa_category_code
            LEFT JOIN organizations o ON o.id = r.organization_id
            ORDER BY r.destination_country ASC, r.visa_category_code ASC, r.effective_from DESC
          `,
          )
          .all()
      : db
          .prepare(
            `
            SELECT r.*, c.name AS country_name, cat.name AS category_name, o.name AS organization_name
            FROM visa_routes r
            JOIN visa_countries c ON c.code = r.destination_country
            JOIN visa_categories cat ON cat.code = r.visa_category_code
            LEFT JOIN organizations o ON o.id = r.organization_id
            WHERE (r.organization_id IS NULL OR r.organization_id = ?)
              ${isApplicant ? "AND r.approval_status = 'PUBLISHED'" : ''}
            ORDER BY CASE WHEN r.organization_id = ? THEN 0 ELSE 1 END, r.destination_country ASC, r.effective_from DESC
          `,
          )
          .all(req.auth!.organizationId, req.auth!.organizationId);

    const formatted = (rows as Array<Record<string, unknown>>).map((row) => {
      let requirements: RequirementTemplate[] = [];
      if (row.requirements_json) {
        try {
          requirements = JSON.parse(String(row.requirements_json)) as RequirementTemplate[];
        } catch {
          requirements = [];
        }
      } else {
        requirements = evaluateCountryVisaRuleEngine(db, {
          destinationCountry: String(row.destination_country),
          visaCategory: String(row.visa_category_code),
          organizationId: row.organization_id ? String(row.organization_id) : undefined,
          hasDependents: false,
        }).templates;
      }

      return {
        ...row,
        isDemoRule: Boolean(row.is_demo_rule),
        approvalStatus: String(row.approval_status || 'PUBLISHED'),
        hasCustomRequirements: Boolean(row.requirements_json),
        requirements,
      };
    });

    res.json({ routes: formatted });
  });

  // 2. Create Draft Country Visa Rule
  router.post(
    '/rules/routes',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const body = (req.body || {}) as Record<string, unknown>;
      const destinationCountry = String(body.destinationCountry || '').trim().toUpperCase();
      const visaCategoryCode = String(body.visaCategoryCode || '').trim().toUpperCase();
      const title = String(body.title || '').trim();
      const ruleVersion = String(body.ruleVersion || '').trim();
      const effectiveFrom = String(body.effectiveFrom || new Date().toISOString().slice(0, 10)).trim();
      const summary = String(body.summary || '').trim();
      const officialSourceUrl = body.officialSourceUrl ? String(body.officialSourceUrl).trim() : null;
      const isDemoRule = body.isDemoRule !== false;
      const scope = String(body.scope || 'ORGANIZATION').toUpperCase();

      if (scope === 'GLOBAL' && !req.auth!.isPlatformAdmin) {
        res.status(403).json({ error: 'Forbidden: only Super Admin can create global platform rules.' });
        return;
      }

      const country = db
        .prepare('SELECT code FROM visa_countries WHERE code = ? AND enabled = 1')
        .get(destinationCountry);
      if (!country) {
        res.status(400).json({ error: 'Valid destinationCountry code is required.' });
        return;
      }

      const category = db
        .prepare('SELECT code FROM visa_categories WHERE code = ?')
        .get(visaCategoryCode);
      if (!category) {
        res.status(400).json({ error: 'Valid visaCategoryCode is required.' });
        return;
      }

      if (!title || title.length < 4) {
        res.status(400).json({ error: 'Rule title (min 4 chars) is required.' });
        return;
      }
      if (!ruleVersion) {
        res.status(400).json({ error: 'ruleVersion is required (e.g., 2026.2-custom).' });
        return;
      }
      if (!summary || summary.length < 10) {
        res.status(400).json({ error: 'Rule summary (min 10 chars) is required.' });
        return;
      }
      if (officialSourceUrl && !isValidHttpUrl(officialSourceUrl)) {
        res.status(400).json({ error: 'officialSourceUrl must be a valid http(s) URL.' });
        return;
      }

      const reqCheck = sanitizeRequirements(body.requirements);
      if (reqCheck.valid === false) {
        res.status(400).json({ error: reqCheck.error });
        return;
      }

      const orgId = scope === 'GLOBAL' && req.auth!.isPlatformAdmin ? null : req.auth!.organizationId;
      const id = newId('route');

      db.prepare(`
        INSERT INTO visa_routes (
          id, organization_id, destination_country, visa_category_code, title, rule_version,
          is_demo_rule, official_source_url, source_verified_at, effective_from, summary,
          approval_status, requirements_json, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'DRAFT', ?, ?)
      `).run(
        id,
        orgId,
        destinationCountry,
        visaCategoryCode,
        title,
        ruleVersion,
        isDemoRule ? 1 : 0,
        officialSourceUrl,
        effectiveFrom,
        summary,
        JSON.stringify(reqCheck.items),
        req.auth!.userId,
      );

      writeAuditLog(db, {
        organizationId: orgId || req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'VISA_RULE_CREATED',
        resourceType: 'VisaRoute',
        resourceId: id,
        metadata: {
          destinationCountry,
          visaCategoryCode,
          ruleVersion,
          approvalStatus: 'DRAFT',
          scope: orgId ? 'ORGANIZATION' : 'GLOBAL',
        },
        ipAddress: req.ip,
      });

      const created = db.prepare('SELECT * FROM visa_routes WHERE id = ?').get(id);
      res.status(201).json({ route: created });
    },
  );

  // 3. Edit Draft / In-Review Country Visa Rule
  router.put(
    '/rules/routes/:id',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const existing = db
        .prepare('SELECT * FROM visa_routes WHERE id = ?')
        .get(req.params.id) as Record<string, unknown> | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Visa rule not found.' });
        return;
      }

      const existingOrgId = existing.organization_id ? String(existing.organization_id) : null;
      if (!existingOrgId && !req.auth!.isPlatformAdmin) {
        res.status(403).json({ error: 'Forbidden: global rules can only be modified by Super Admin.' });
        return;
      }
      if (existingOrgId && !req.auth!.isPlatformAdmin && existingOrgId !== req.auth!.organizationId) {
        res.status(403).json({ error: 'Forbidden: cross-tenant rule modification denied.' });
        return;
      }

      const currentStatus = String(existing.approval_status || 'PUBLISHED') as ApprovalStatus;
      if (!['DRAFT', 'IN_REVIEW'].includes(currentStatus)) {
        res.status(400).json({
          error: `Cannot edit a ${currentStatus} rule version directly. Clone it as a new DRAFT version instead.`,
        });
        return;
      }

      const body = (req.body || {}) as Record<string, unknown>;
      const title = String(body.title ?? existing.title).trim();
      const ruleVersion = String(body.ruleVersion ?? existing.rule_version).trim();
      const effectiveFrom = String(body.effectiveFrom ?? existing.effective_from).trim();
      const summary = String(body.summary ?? existing.summary).trim();
      const officialSourceUrl =
        body.officialSourceUrl !== undefined
          ? body.officialSourceUrl
            ? String(body.officialSourceUrl).trim()
            : null
          : existing.official_source_url
            ? String(existing.official_source_url)
            : null;
      const isDemoRule =
        body.isDemoRule !== undefined ? Boolean(body.isDemoRule) : Boolean(existing.is_demo_rule);

      if (!title || title.length < 4 || !ruleVersion || !summary || summary.length < 10) {
        res.status(400).json({ error: 'Valid title, ruleVersion, and summary are required.' });
        return;
      }
      if (officialSourceUrl && !isValidHttpUrl(officialSourceUrl)) {
        res.status(400).json({ error: 'officialSourceUrl must be a valid http(s) URL.' });
        return;
      }

      let requirementsJson = existing.requirements_json ? String(existing.requirements_json) : null;
      if (body.requirements !== undefined) {
        const reqCheck = sanitizeRequirements(body.requirements);
        if (reqCheck.valid === false) {
          res.status(400).json({ error: reqCheck.error });
          return;
        }
        requirementsJson = JSON.stringify(reqCheck.items);
      }

      db.prepare(`
        UPDATE visa_routes
        SET title = ?, rule_version = ?, effective_from = ?, summary = ?,
            official_source_url = ?, is_demo_rule = ?, requirements_json = ?
        WHERE id = ?
      `).run(
        title,
        ruleVersion,
        effectiveFrom,
        summary,
        officialSourceUrl,
        isDemoRule ? 1 : 0,
        requirementsJson,
        req.params.id,
      );

      writeAuditLog(db, {
        organizationId: existingOrgId || req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'VISA_RULE_UPDATED',
        resourceType: 'VisaRoute',
        resourceId: req.params.id,
        metadata: { ruleVersion, title, approvalStatus: currentStatus },
        ipAddress: req.ip,
      });

      const updated = db.prepare('SELECT * FROM visa_routes WHERE id = ?').get(req.params.id);
      res.json({ route: updated });
    },
  );

  // 4. Transition Country Rule Approval Workflow (DRAFT -> IN_REVIEW -> PUBLISHED -> ARCHIVED)
  router.post(
    '/rules/routes/:id/transition',
    requireAuth,
    requireRoles('AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      const targetStatus = String((req.body || {}).targetStatus || '').toUpperCase() as ApprovalStatus;
      if (!['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'].includes(targetStatus)) {
        res.status(400).json({ error: 'Valid targetStatus is required.' });
        return;
      }

      const existing = db
        .prepare('SELECT * FROM visa_routes WHERE id = ?')
        .get(req.params.id) as Record<string, unknown> | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Visa rule not found.' });
        return;
      }

      const existingOrgId = existing.organization_id ? String(existing.organization_id) : null;
      if (!existingOrgId && !req.auth!.isPlatformAdmin) {
        res.status(403).json({ error: 'Forbidden: global rules can only be transitioned by Super Admin.' });
        return;
      }
      if (existingOrgId && !req.auth!.isPlatformAdmin && existingOrgId !== req.auth!.organizationId) {
        res.status(403).json({ error: 'Forbidden: cross-tenant rule transition denied.' });
        return;
      }

      const fromStatus = String(existing.approval_status || 'PUBLISHED') as ApprovalStatus;
      if (!ALLOWED_RULE_TRANSITIONS[fromStatus]?.includes(targetStatus)) {
        res.status(400).json({
          error: `Invalid rule workflow transition from ${fromStatus} to ${targetStatus}.`,
        });
        return;
      }

      const isDemoRule = Boolean(existing.is_demo_rule);
      const sourceUrl = existing.official_source_url ? String(existing.official_source_url) : null;
      if (targetStatus === 'PUBLISHED' && !isDemoRule && !isValidHttpUrl(sourceUrl)) {
        res.status(400).json({
          error:
            'Publishing a non-demo official rule requires a valid officialSourceUrl for compliance provenance.',
        });
        return;
      }

      const now = new Date().toISOString();
      if (targetStatus === 'PUBLISHED') {
        db.prepare(`
          UPDATE visa_routes
          SET approval_status = 'PUBLISHED', approved_by_user_id = ?, approved_at = ?, source_verified_at = ?
          WHERE id = ?
        `).run(req.auth!.userId, now, now, req.params.id);
      } else {
        db.prepare('UPDATE visa_routes SET approval_status = ? WHERE id = ?').run(
          targetStatus,
          req.params.id,
        );
      }

      writeAuditLog(db, {
        organizationId: existingOrgId || req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'VISA_RULE_STATUS_CHANGED',
        resourceType: 'VisaRoute',
        resourceId: req.params.id,
        metadata: { fromStatus, toStatus: targetStatus, ruleVersion: existing.rule_version },
        ipAddress: req.ip,
      });

      const updated = db.prepare('SELECT * FROM visa_routes WHERE id = ?').get(req.params.id);
      res.json({ updated: true, route: updated });
    },
  );

  // 5. Evaluate Deterministic Country Rule Engine Preview
  router.post(
    '/rules/evaluate-preview',
    requireAuth,
    requireRoles('CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      const body = (req.body || {}) as Record<string, unknown>;
      const destinationCountry = String(body.destinationCountry || 'DE').trim().toUpperCase();
      const visaCategory = String(body.visaCategory || 'TOURIST').trim().toUpperCase();
      const hasDependents = Boolean(body.hasDependents);
      const travelDurationDays = Number(body.travelDurationDays || 14);
      const routeId = body.routeId ? String(body.routeId) : null;

      const evaluation = evaluateCountryVisaRuleEngine(db, {
        destinationCountry,
        visaCategory,
        organizationId: req.auth!.organizationId,
        routeId,
        hasDependents,
        travelDurationDays: Number.isFinite(travelDurationDays) ? travelDurationDays : 14,
      });

      const resolvedForm = resolveFormSchemaForCase(
        db,
        destinationCountry,
        visaCategory,
        req.auth!.organizationId,
      );

      res.json({
        destinationCountry,
        visaCategory,
        hasDependents,
        travelDurationDays,
        ruleSource: evaluation.ruleSource,
        matchedRoute: evaluation.matchedRoute,
        requirements: evaluation.templates,
        matchedFormSchema: {
          id: resolvedForm.row.id,
          schemaKey: resolvedForm.schema.schemaKey,
          version: resolvedForm.schema.version,
          title: resolvedForm.schema.title,
          stepCount: resolvedForm.schema.steps.length,
          fieldCount: Object.keys(resolvedForm.schema.properties).length,
        },
      });
    },
  );

  // 6. List Dynamic Form Schemas with full JSON definitions (staff builder)
  router.get('/rules/form-schemas', requireAuth, (req, res) => {
    seedFormSchemas(db);
    const isApplicant = req.auth!.role === 'APPLICANT' && !req.auth!.isPlatformAdmin;
    const requestedPlatformScope = req.query.scope === 'platform' && req.auth!.isPlatformAdmin;

    const rows = requestedPlatformScope
      ? db
          .prepare(
            `
            SELECT s.*, o.name AS organization_name
            FROM visa_form_schemas s
            LEFT JOIN organizations o ON o.id = s.organization_id
            ORDER BY s.destination_country ASC, s.visa_category_code ASC, s.created_at DESC
          `,
          )
          .all()
      : db
          .prepare(
            `
            SELECT s.*, o.name AS organization_name
            FROM visa_form_schemas s
            LEFT JOIN organizations o ON o.id = s.organization_id
            WHERE (s.organization_id IS NULL OR s.organization_id = ?)
              ${isApplicant ? "AND s.approval_status = 'PUBLISHED'" : ''}
            ORDER BY CASE WHEN s.organization_id = ? THEN 0 ELSE 1 END, s.destination_country ASC, s.created_at DESC
          `,
          )
          .all(req.auth!.organizationId, req.auth!.organizationId);

    const schemas = (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      organizationId: row.organization_id ? String(row.organization_id) : null,
      organizationName: row.organization_name ? String(row.organization_name) : null,
      destinationCountry: String(row.destination_country),
      visaCategoryCode: String(row.visa_category_code),
      schemaKey: String(row.schema_key),
      version: String(row.version),
      title: String(row.title),
      isDemoRule: Boolean(row.is_demo_rule),
      officialSourceUrl: row.official_source_url ? String(row.official_source_url) : null,
      approvalStatus: String(row.approval_status || 'PUBLISHED'),
      createdAt: String(row.created_at),
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      schema: JSON.parse(String(row.schema_json)) as VisaFormJsonSchema,
    }));

    res.json({ schemas });
  });

  // 7. Create Draft Dynamic Visa Form Schema
  router.post(
    '/rules/form-schemas',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const body = (req.body || {}) as Record<string, unknown>;
      const destinationCountry = String(body.destinationCountry || '*').trim().toUpperCase();
      const visaCategoryCode = String(body.visaCategoryCode || '*').trim().toUpperCase();
      const officialSourceUrl = body.officialSourceUrl ? String(body.officialSourceUrl).trim() : null;
      const isDemoRule = body.isDemoRule !== false;
      const scope = String(body.scope || 'ORGANIZATION').toUpperCase();

      if (scope === 'GLOBAL' && !req.auth!.isPlatformAdmin) {
        res.status(403).json({ error: 'Forbidden: only Super Admin can create global form schemas.' });
        return;
      }
      if (officialSourceUrl && !isValidHttpUrl(officialSourceUrl)) {
        res.status(400).json({ error: 'officialSourceUrl must be a valid http(s) URL.' });
        return;
      }

      const check = sanitizeFormSchemaSpec({
        schemaKey: String(body.schemaKey || ''),
        version: String(body.version || ''),
        title: String(body.title || ''),
        destinationCountry,
        visaCategoryCode,
        isDemoRule,
        officialSourceUrl,
        steps: body.steps,
        properties: body.properties,
      });

      if (check.valid === false) {
        res.status(400).json({ error: check.error });
        return;
      }

      const dup = db
        .prepare('SELECT id FROM visa_form_schemas WHERE schema_key = ? AND version = ?')
        .get(check.schema.schemaKey, check.schema.version);
      if (dup) {
        res.status(409).json({
          error: `Form schema "${check.schema.schemaKey}" version "${check.schema.version}" already exists.`,
        });
        return;
      }

      const orgId = scope === 'GLOBAL' && req.auth!.isPlatformAdmin ? null : req.auth!.organizationId;
      const id = newId('fschema');
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO visa_form_schemas (
          id, organization_id, destination_country, visa_category_code, schema_key, version,
          title, is_demo_rule, official_source_url, schema_json, approval_status,
          created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)
      `).run(
        id,
        orgId,
        check.schema.destinationCountry,
        check.schema.visaCategoryCode,
        check.schema.schemaKey,
        check.schema.version,
        check.schema.title,
        check.schema.isDemoRule ? 1 : 0,
        check.schema.officialSourceUrl,
        JSON.stringify(check.schema),
        req.auth!.userId,
        now,
      );

      writeAuditLog(db, {
        organizationId: orgId || req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'FORM_SCHEMA_CREATED',
        resourceType: 'VisaFormSchema',
        resourceId: id,
        metadata: {
          schemaKey: check.schema.schemaKey,
          version: check.schema.version,
          destinationCountry: check.schema.destinationCountry,
          visaCategoryCode: check.schema.visaCategoryCode,
        },
        ipAddress: req.ip,
      });

      res.status(201).json({
        schemaId: id,
        approvalStatus: 'DRAFT',
        schema: check.schema,
      });
    },
  );

  // 8. Edit Draft / In-Review Dynamic Visa Form Schema
  router.put(
    '/rules/form-schemas/:id',
    requireAuth,
    requireRoles('AGENCY_ADMIN'),
    (req, res) => {
      const existing = db
        .prepare('SELECT * FROM visa_form_schemas WHERE id = ?')
        .get(req.params.id) as Record<string, unknown> | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Form schema not found.' });
        return;
      }

      const existingOrgId = existing.organization_id ? String(existing.organization_id) : null;
      if (!existingOrgId && !req.auth!.isPlatformAdmin) {
        res.status(403).json({ error: 'Forbidden: global form schemas can only be modified by Super Admin.' });
        return;
      }
      if (existingOrgId && !req.auth!.isPlatformAdmin && existingOrgId !== req.auth!.organizationId) {
        res.status(403).json({ error: 'Forbidden: cross-tenant form schema modification denied.' });
        return;
      }

      const currentStatus = String(existing.approval_status || 'PUBLISHED') as ApprovalStatus;
      if (!['DRAFT', 'IN_REVIEW'].includes(currentStatus)) {
        res.status(400).json({
          error: `Cannot edit a ${currentStatus} form schema directly. Clone it as a new DRAFT version instead.`,
        });
        return;
      }

      const prevSchema = JSON.parse(String(existing.schema_json)) as VisaFormJsonSchema;
      const body = (req.body || {}) as Record<string, unknown>;
      const officialSourceUrl =
        body.officialSourceUrl !== undefined
          ? body.officialSourceUrl
            ? String(body.officialSourceUrl).trim()
            : null
          : prevSchema.officialSourceUrl;

      if (officialSourceUrl && !isValidHttpUrl(officialSourceUrl)) {
        res.status(400).json({ error: 'officialSourceUrl must be a valid http(s) URL.' });
        return;
      }

      const check = sanitizeFormSchemaSpec({
        schemaKey: String(existing.schema_key),
        version: String(body.version ?? existing.version),
        title: String(body.title ?? existing.title),
        destinationCountry: String(body.destinationCountry ?? existing.destination_country)
          .trim()
          .toUpperCase(),
        visaCategoryCode: String(body.visaCategoryCode ?? existing.visa_category_code)
          .trim()
          .toUpperCase(),
        isDemoRule:
          body.isDemoRule !== undefined ? Boolean(body.isDemoRule) : Boolean(existing.is_demo_rule),
        officialSourceUrl,
        steps: body.steps ?? prevSchema.steps,
        properties: body.properties ?? prevSchema.properties,
      });

      if (check.valid === false) {
        res.status(400).json({ error: check.error });
        return;
      }

      db.prepare(`
        UPDATE visa_form_schemas
        SET destination_country = ?, visa_category_code = ?, version = ?, title = ?,
            is_demo_rule = ?, official_source_url = ?, schema_json = ?
        WHERE id = ?
      `).run(
        check.schema.destinationCountry,
        check.schema.visaCategoryCode,
        check.schema.version,
        check.schema.title,
        check.schema.isDemoRule ? 1 : 0,
        check.schema.officialSourceUrl,
        JSON.stringify(check.schema),
        req.params.id,
      );

      writeAuditLog(db, {
        organizationId: existingOrgId || req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'FORM_SCHEMA_UPDATED',
        resourceType: 'VisaFormSchema',
        resourceId: req.params.id,
        metadata: { schemaKey: check.schema.schemaKey, version: check.schema.version },
        ipAddress: req.ip,
      });

      res.json({ updated: true, schema: check.schema });
    },
  );

  // 9. Transition Dynamic Visa Form Schema (DRAFT -> IN_REVIEW -> PUBLISHED -> ARCHIVED)
  router.post(
    '/rules/form-schemas/:id/transition',
    requireAuth,
    requireRoles('AGENCY_ADMIN', 'VERIFICATION_OFFICER'),
    (req, res) => {
      const targetStatus = String((req.body || {}).targetStatus || '').toUpperCase() as ApprovalStatus;
      if (!['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'].includes(targetStatus)) {
        res.status(400).json({ error: 'Valid targetStatus is required.' });
        return;
      }

      const existing = db
        .prepare('SELECT * FROM visa_form_schemas WHERE id = ?')
        .get(req.params.id) as Record<string, unknown> | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Form schema not found.' });
        return;
      }

      const existingOrgId = existing.organization_id ? String(existing.organization_id) : null;
      if (!existingOrgId && !req.auth!.isPlatformAdmin) {
        res.status(403).json({ error: 'Forbidden: global form schemas can only be transitioned by Super Admin.' });
        return;
      }
      if (existingOrgId && !req.auth!.isPlatformAdmin && existingOrgId !== req.auth!.organizationId) {
        res.status(403).json({ error: 'Forbidden: cross-tenant form schema transition denied.' });
        return;
      }

      const fromStatus = String(existing.approval_status || 'PUBLISHED') as ApprovalStatus;
      if (!ALLOWED_RULE_TRANSITIONS[fromStatus]?.includes(targetStatus)) {
        res.status(400).json({
          error: `Invalid form schema transition from ${fromStatus} to ${targetStatus}.`,
        });
        return;
      }

      const now = new Date().toISOString();
      if (targetStatus === 'PUBLISHED') {
        db.prepare(`
          UPDATE visa_form_schemas
          SET approval_status = 'PUBLISHED', approved_by_user_id = ?, approved_at = ?
          WHERE id = ?
        `).run(req.auth!.userId, now, req.params.id);
      } else {
        db.prepare('UPDATE visa_form_schemas SET approval_status = ? WHERE id = ?').run(
          targetStatus,
          req.params.id,
        );
      }

      writeAuditLog(db, {
        organizationId: existingOrgId || req.auth!.organizationId,
        actorUserId: req.auth!.userId,
        action: 'FORM_SCHEMA_STATUS_CHANGED',
        resourceType: 'VisaFormSchema',
        resourceId: req.params.id,
        metadata: {
          schemaKey: existing.schema_key,
          version: existing.version,
          fromStatus,
          toStatus: targetStatus,
        },
        ipAddress: req.ip,
      });

      res.json({ updated: true, approvalStatus: targetStatus });
    },
  );

  return router;
}
