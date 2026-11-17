import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  GitBranch,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  DOCUMENT_TYPE_LABELS,
  FormSchemaRecord,
  FormStepDefinition,
  formatShortDate,
  JsonSchemaFieldSpec,
  RuleApprovalStatus,
  RuleConditionType,
  statusSemanticTone,
  VisaCategoryItem,
  VisaCountryItem,
  VisaRuleRequirementItem,
  VisaRuleRouteDetail,
} from '../types';

interface RuleFormBuilderViewProps {
  currentUser: AuthUser;
  countries: VisaCountryItem[];
  categories: VisaCategoryItem[];
  onCatalogUpdated?: () => void;
}

const APPROVAL_LABELS: Record<RuleApprovalStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In Review',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

const CONDITION_LABELS: Record<RuleConditionType, string> = {
  ALWAYS: 'Always Required',
  HAS_DEPENDENTS: 'If Dependents Listed',
  STAY_OVER_30_DAYS: 'If Stay > 30 Days',
};

const EMPTY_REQUIREMENT: VisaRuleRequirementItem = {
  requirementCode: 'PASSPORT_BIO_PAGE',
  title: 'Valid Passport Biographical Page',
  description: 'Clear color scan of passport bio-data page.',
  documentType: 'PASSPORT',
  isMandatory: true,
  conditionNote: 'Always required across all routes.',
  conditionType: 'ALWAYS',
};

const DEFAULT_STEPS: FormStepDefinition[] = [
  {
    id: 'identity',
    title: 'Applicant & Passport Identity',
    description: 'Biographical and verified passport fields.',
    order: 0,
  },
  {
    id: 'travel',
    title: 'Travel & Supporting Details',
    description: 'Trip dates, lodging, and purpose statement.',
    order: 1,
  },
];

const DEFAULT_FIELDS: Array<{ key: string; spec: JsonSchemaFieldSpec }> = [
  {
    key: 'fullLegalName',
    spec: {
      type: 'string',
      title: 'Full Legal Name',
      minLength: 2,
      stepId: 'identity',
      required: true,
    },
  },
  {
    key: 'passportNumber',
    spec: {
      type: 'string',
      title: 'Passport Number',
      minLength: 5,
      stepId: 'identity',
      required: true,
      sensitiveMasked: true,
    },
  },
  {
    key: 'purposeSummary',
    spec: {
      type: 'string',
      title: 'Purpose of Travel Summary',
      format: 'textarea',
      minLength: 15,
      stepId: 'travel',
      required: true,
      aiSuggestible: true,
    },
  },
];

export const RuleFormBuilderView: React.FC<RuleFormBuilderViewProps> = ({
  currentUser,
  countries,
  categories,
  onCatalogUpdated,
}) => {
  const canAuthor =
    currentUser.role === 'AGENCY_ADMIN' || currentUser.isPlatformAdmin;
  const canReview =
    canAuthor || currentUser.role === 'VERIFICATION_OFFICER';

  const [activeTab, setActiveTab] = useState<'rules' | 'forms'>('rules');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [routes, setRoutes] = useState<VisaRuleRouteDetail[]>([]);
  const [schemas, setSchemas] = useState<FormSchemaRecord[]>([]);

  // Rule Engine Filters & Simulator
  const [ruleStatusFilter, setRuleStatusFilter] = useState<string>('ALL');
  const [ruleCountryFilter, setRuleCountryFilter] = useState<string>('ALL');
  const [simCountry, setSimCountry] = useState<string>('DE');
  const [simCategory, setSimCategory] = useState<string>('TOURIST');
  const [simStayDays, setSimStayDays] = useState<number>(14);
  const [simHasDependents, setSimHasDependents] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<{
    ruleSource: string;
    matchedRoute: Record<string, unknown> | null;
    requirements: VisaRuleRequirementItem[];
    matchedFormSchema: {
      schemaKey: string;
      version: string;
      title: string;
      stepCount: number;
      fieldCount: number;
    };
  } | null>(null);

  // Rule Authoring State
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleCountry, setRuleCountry] = useState('DE');
  const [ruleCategory, setRuleCategory] = useState('TOURIST');
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleVersion, setRuleVersion] = useState('2026.2-custom');
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [ruleSourceUrl, setRuleSourceUrl] = useState('');
  const [ruleIsDemo, setRuleIsDemo] = useState(true);
  const [ruleScope, setRuleScope] = useState<'ORGANIZATION' | 'GLOBAL'>('ORGANIZATION');
  const [ruleSummary, setRuleSummary] = useState('');
  const [ruleRequirements, setRuleRequirements] = useState<VisaRuleRequirementItem[]>([
    { ...EMPTY_REQUIREMENT },
  ]);

  // Form Builder State
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [formEditorMode, setFormEditorMode] = useState<'edit' | 'preview'>('edit');
  const [showFormCreator, setShowFormCreator] = useState(false);
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [schemaKey, setSchemaKey] = useState('custom-visa-intake');
  const [schemaVersion, setSchemaVersion] = useState('2026.2-custom');
  const [schemaTitle, setSchemaTitle] = useState('');
  const [schemaCountry, setSchemaCountry] = useState('DE');
  const [schemaCategory, setSchemaCategory] = useState('TOURIST');
  const [schemaSourceUrl, setSchemaSourceUrl] = useState('');
  const [schemaIsDemo, setSchemaIsDemo] = useState(true);
  const [schemaSteps, setSchemaSteps] = useState<FormStepDefinition[]>(DEFAULT_STEPS);
  const [schemaFields, setSchemaFields] =
    useState<Array<{ key: string; spec: JsonSchemaFieldSpec }>>(DEFAULT_FIELDS);
  const [previewStepIndex, setPreviewStepIndex] = useState(0);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, unknown>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [routesRes, schemasRes] = await Promise.all([
        apiRequest<{ routes: VisaRuleRouteDetail[] }>('/api/rules/routes'),
        apiRequest<{ schemas: FormSchemaRecord[] }>('/api/rules/form-schemas'),
      ]);
      setRoutes(routesRes.routes);
      setSchemas(schemasRes.schemas);
      if (schemasRes.schemas.length > 0 && !selectedSchemaId) {
        setSelectedSchemaId(schemasRes.schemas[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load Country Rule Engine and Form Schemas.');
    } finally {
      setLoading(false);
    }
  }, [selectedSchemaId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (ruleStatusFilter !== 'ALL' && r.approvalStatus !== ruleStatusFilter) return false;
      if (ruleCountryFilter !== 'ALL' && r.destination_country !== ruleCountryFilter) {
        return false;
      }
      return true;
    });
  }, [routes, ruleStatusFilter, ruleCountryFilter]);

  const selectedSchema = useMemo(
    () => schemas.find((s) => s.id === selectedSchemaId) || schemas[0] || null,
    [schemas, selectedSchemaId],
  );

  function openNewRuleEditor() {
    setEditingRuleId(null);
    setRuleCountry(countries[0]?.code || 'DE');
    setRuleCategory(categories[0]?.code || 'TOURIST');
    setRuleTitle('');
    setRuleVersion(`2026.${Math.floor(Date.now() / 1000) % 1000}-custom`);
    setRuleEffectiveFrom(new Date().toISOString().slice(0, 10));
    setRuleSourceUrl('');
    setRuleIsDemo(true);
    setRuleScope('ORGANIZATION');
    setRuleSummary('');
    setRuleRequirements([{ ...EMPTY_REQUIREMENT }]);
    setShowRuleEditor(true);
    setError(null);
  }

  function openEditOrCloneRule(route: VisaRuleRouteDetail, cloneAsNew: boolean) {
    setEditingRuleId(cloneAsNew ? null : route.id);
    setRuleCountry(route.destination_country);
    setRuleCategory(route.visa_category_code);
    setRuleTitle(cloneAsNew ? `${route.title} (v2)` : route.title);
    setRuleVersion(cloneAsNew ? `${route.rule_version}-rev2` : route.rule_version);
    setRuleEffectiveFrom(route.effective_from || new Date().toISOString().slice(0, 10));
    setRuleSourceUrl(route.official_source_url || '');
    setRuleIsDemo(route.isDemoRule);
    setRuleScope(route.organization_id ? 'ORGANIZATION' : 'GLOBAL');
    setRuleSummary(route.summary);
    setRuleRequirements(
      route.requirements.length > 0
        ? route.requirements.map((req) => ({ ...req }))
        : [{ ...EMPTY_REQUIREMENT }],
    );
    setShowRuleEditor(true);
    setError(null);
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        destinationCountry: ruleCountry,
        visaCategoryCode: ruleCategory,
        title: ruleTitle,
        ruleVersion,
        effectiveFrom: ruleEffectiveFrom,
        officialSourceUrl: ruleSourceUrl.trim() || null,
        isDemoRule: ruleIsDemo,
        scope: currentUser.isPlatformAdmin ? ruleScope : 'ORGANIZATION',
        summary: ruleSummary,
        requirements: ruleRequirements,
      };
      if (editingRuleId) {
        await apiRequest(`/api/rules/routes/${editingRuleId}`, {
          method: 'PUT',
          body: payload,
        });
        setNotice(`Saved draft changes to rule version ${ruleVersion}.`);
      } else {
        await apiRequest('/api/rules/routes', {
          method: 'POST',
          body: payload,
        });
        setNotice(`Created Draft visa rule version ${ruleVersion}.`);
      }
      setShowRuleEditor(false);
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Unable to save visa rule.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransitionRule(
    routeId: string,
    targetStatus: RuleApprovalStatus,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/rules/routes/${routeId}/transition`, {
        method: 'POST',
        body: { targetStatus },
      });
      setNotice(`Visa rule transitioned to ${APPROVAL_LABELS[targetStatus]}.`);
      await loadAll();
      if (onCatalogUpdated) onCatalogUpdated();
    } catch (err: any) {
      setError(err.message || 'Rule transition failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSimulateRuleEngine(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<typeof simResult>('/api/rules/evaluate-preview', {
        method: 'POST',
        body: {
          destinationCountry: simCountry,
          visaCategory: simCategory,
          travelDurationDays: simStayDays,
          hasDependents: simHasDependents,
        },
      });
      setSimResult(res);
    } catch (err: any) {
      setError(err.message || 'Rule simulation failed.');
    } finally {
      setBusy(false);
    }
  }

  function openNewFormSchema() {
    setEditingFormId(null);
    setSchemaKey(`custom-${(countries[0]?.code || 'de').toLowerCase()}-intake`);
    setSchemaVersion(`2026.${Math.floor(Date.now() / 1000) % 1000}-custom`);
    setSchemaTitle('');
    setSchemaCountry(countries[0]?.code || 'DE');
    setSchemaCategory(categories[0]?.code || 'TOURIST');
    setSchemaSourceUrl('');
    setSchemaIsDemo(true);
    setSchemaSteps(DEFAULT_STEPS.map((s) => ({ ...s })));
    setSchemaFields(DEFAULT_FIELDS.map((f) => ({ key: f.key, spec: { ...f.spec } })));
    setShowFormCreator(true);
    setFormEditorMode('edit');
    setError(null);
  }

  function openEditOrCloneSchema(record: FormSchemaRecord, cloneAsNew: boolean) {
    setEditingFormId(cloneAsNew ? null : record.id);
    setSchemaKey(cloneAsNew ? `${record.schemaKey}-org` : record.schemaKey);
    setSchemaVersion(cloneAsNew ? `${record.version}-custom` : record.version);
    setSchemaTitle(cloneAsNew ? `${record.title} (Custom)` : record.title);
    setSchemaCountry(record.destinationCountry);
    setSchemaCategory(record.visaCategoryCode);
    setSchemaSourceUrl(record.officialSourceUrl || '');
    setSchemaIsDemo(record.isDemoRule);
    setSchemaSteps(record.schema.steps.map((s) => ({ ...s })));
    setSchemaFields(
      Object.entries(record.schema.properties).map(([key, spec]) => ({
        key,
        spec: { ...spec },
      })),
    );
    setShowFormCreator(true);
    setFormEditorMode('edit');
    setError(null);
  }

  async function handleSaveFormSchema(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const properties: Record<string, JsonSchemaFieldSpec> = {};
      for (const item of schemaFields) {
        if (item.key.trim()) {
          properties[item.key.trim()] = item.spec;
        }
      }
      const payload = {
        schemaKey,
        version: schemaVersion,
        title: schemaTitle,
        destinationCountry: schemaCountry,
        visaCategoryCode: schemaCategory,
        officialSourceUrl: schemaSourceUrl.trim() || null,
        isDemoRule: schemaIsDemo,
        steps: schemaSteps,
        properties,
      };
      if (editingFormId) {
        await apiRequest(`/api/rules/form-schemas/${editingFormId}`, {
          method: 'PUT',
          body: payload,
        });
        setNotice(`Updated draft form schema ${schemaKey} (${schemaVersion}).`);
      } else {
        const res = await apiRequest<{ schemaId: string }>('/api/rules/form-schemas', {
          method: 'POST',
          body: payload,
        });
        setSelectedSchemaId(res.schemaId);
        setNotice(`Created draft dynamic form schema ${schemaKey} (${schemaVersion}).`);
      }
      setShowFormCreator(false);
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Unable to save dynamic form schema.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransitionFormSchema(
    id: string,
    targetStatus: RuleApprovalStatus,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/rules/form-schemas/${id}/transition`, {
        method: 'POST',
        body: { targetStatus },
      });
      setNotice(`Dynamic form schema transitioned to ${APPROVAL_LABELS[targetStatus]}.`);
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Form schema transition failed.');
    } finally {
      setBusy(false);
    }
  }

  const activePreviewSchema = useMemo(() => {
    if (showFormCreator) {
      const props: Record<string, JsonSchemaFieldSpec> = {};
      for (const f of schemaFields) {
        if (f.key.trim()) props[f.key.trim()] = f.spec;
      }
      return {
        title: schemaTitle || 'Untitled Form Schema Preview',
        steps: schemaSteps,
        properties: props,
      };
    }
    return selectedSchema?.schema || null;
  }, [showFormCreator, schemaFields, schemaTitle, schemaSteps, selectedSchema]);

  const previewSteps = activePreviewSchema?.steps || [];
  const safePreviewStepIdx = Math.min(previewStepIndex, Math.max(0, previewSteps.length - 1));
  const currentPreviewStep = previewSteps[safePreviewStepIdx];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">
            Country Visa Rule Engine &amp; Dynamic Form Builder
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Author deterministic country document checklists, manage Draft → In Review → Published governance, and customize conditional multi-step visa forms.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('rules')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'rules'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Country Rule Engine</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('forms')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'forms'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Dynamic Form Builder</span>
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 flex flex-wrap items-center justify-between gap-3 text-xs text-red-800 dark:text-red-300"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1 px-2.5 py-1 border border-red-400 dark:border-red-700 rounded-lg font-medium hover:bg-red-100 dark:hover:bg-red-900/40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry Load</span>
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-700 dark:text-emerald-400 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3 animate-pulse">
          <div className="h-4 w-52 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="h-10 w-full bg-slate-100 dark:bg-slate-800/70 rounded" />
          <div className="h-10 w-full bg-slate-100 dark:bg-slate-800/70 rounded" />
        </div>
      ) : activeTab === 'rules' ? (
        <div className="space-y-6">
          {/* Top Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Published Rules</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {routes.filter((r) => r.approvalStatus === 'PUBLISHED').length}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Pending Review</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {routes.filter((r) => r.approvalStatus === 'IN_REVIEW').length}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Draft Versions</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {routes.filter((r) => r.approvalStatus === 'DRAFT').length}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Active Form Schemas</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {schemas.filter((s) => s.approvalStatus === 'PUBLISHED').length}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Left: Rule Catalog & Governance Table */}
            <div className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Versioned Country Visa Rules</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Published rules drive dynamic checklists on newly created cases. Drafts require review before publishing.
                  </p>
                </div>
                {canAuthor && (
                  <button
                    type="button"
                    onClick={openNewRuleEditor}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Country Rule</span>
                  </button>
                )}
              </div>

              <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
                <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span>Status</span>
                  <select
                    aria-label="Filter rules by approval status"
                    value={ruleStatusFilter}
                    onChange={(e) => setRuleStatusFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="DRAFT">Draft</option>
                    <option value="IN_REVIEW">In Review</option>
                    <option value="PUBLISHED">Published</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </label>

                <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span>Country</span>
                  <select
                    aria-label="Filter rules by country"
                    value={ruleCountryFilter}
                    onChange={(e) => setRuleCountryFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    <option value="ALL">All Countries</option>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {filteredRoutes.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No country visa rules match the selected filters.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredRoutes.map((r) => {
                    const isEditable =
                      canAuthor &&
                      ['DRAFT', 'IN_REVIEW'].includes(r.approvalStatus) &&
                      (Boolean(r.organization_id) || currentUser.isPlatformAdmin);

                    return (
                      <div key={r.id} className="p-5 space-y-2.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {r.title}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span>
                                {r.country_name} ({r.destination_country})
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{r.category_name}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">{r.rule_version}</span>
                              <span aria-hidden="true">·</span>
                              <span>{r.organization_id ? 'Tenant Custom' : 'Platform Global'}</span>
                              <span aria-hidden="true">·</span>
                              <span>{r.isDemoRule ? 'Demonstration Rule' : 'Verified Official Rule'}</span>
                              <span aria-hidden="true">·</span>
                              <span className={`font-medium ${statusSemanticTone(r.approvalStatus)}`}>
                                {APPROVAL_LABELS[r.approvalStatus]}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {isEditable && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openEditOrCloneRule(r, false)}
                                className="px-2.5 py-1 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                Edit Draft
                              </button>
                            )}
                            {canAuthor && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openEditOrCloneRule(r, true)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Copy className="w-3 h-3" />
                                <span>Clone Version</span>
                              </button>
                            )}
                            {canAuthor &&
                              r.approvalStatus === 'DRAFT' &&
                              (Boolean(r.organization_id) || currentUser.isPlatformAdmin) && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleTransitionRule(r.id, 'IN_REVIEW')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>Submit for Review</span>
                                </button>
                              )}
                            {canReview &&
                              r.approvalStatus === 'IN_REVIEW' &&
                              (Boolean(r.organization_id) || currentUser.isPlatformAdmin) && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => handleTransitionRule(r.id, 'PUBLISHED')}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Approve &amp; Publish</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => handleTransitionRule(r.id, 'DRAFT')}
                                    className="px-2.5 py-1 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    Return to Draft
                                  </button>
                                </>
                              )}
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-400">{r.summary}</p>

                        <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                          <span className="tabular-nums">
                            {r.requirements.length} checklist requirements
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Effective {formatShortDate(r.effective_from)}</span>
                          {r.official_source_url && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate max-w-xs">
                                Source: {r.official_source_url}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Deterministic Rule Engine Simulator */}
            <div className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold">Country Rule Engine Simulator</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Test deterministic document checklists and matched dynamic form schemas for any route scenario.
                </p>
              </div>

              <form onSubmit={handleSimulateRuleEngine} className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="sim-country" className="text-xs font-medium">
                    Destination Country
                  </label>
                  <select
                    id="sim-country"
                    value={simCountry}
                    onChange={(e) => setSimCountry(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="sim-category" className="text-xs font-medium">
                    Visa Category
                  </label>
                  <select
                    id="sim-category"
                    value={simCategory}
                    onChange={(e) => setSimCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    {categories.map((cat) => (
                      <option key={cat.code} value={cat.code}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="sim-days" className="text-xs font-medium">
                    Intended Stay Duration (Days)
                  </label>
                  <input
                    id="sim-days"
                    type="number"
                    min={1}
                    max={1825}
                    value={simStayDays}
                    onChange={(e) => setSimStayDays(Number(e.target.value || 14))}
                    className="w-full px-3 py-2 text-xs tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simHasDependents}
                    onChange={(e) => setSimHasDependents(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700"
                  />
                  <span>Applicant traveling with accompanying dependents</span>
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2 px-4 text-xs font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 rounded-lg whitespace-nowrap cursor-pointer"
                >
                  Evaluate Country Rules
                </button>
              </form>

              {simResult && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="text-xs space-y-1">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Evaluated Requirements ({simResult.requirements.length})
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      Engine: {simResult.ruleSource} · Form:{' '}
                      <span className="font-mono">{simResult.matchedFormSchema.schemaKey}</span> (
                      {simResult.matchedFormSchema.version})
                    </div>
                  </div>
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {simResult.requirements.map((req) => (
                      <li key={req.requirementCode} className="py-2 space-y-0.5">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {req.title}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400">
                          {DOCUMENT_TYPE_LABELS[req.documentType] || req.documentType} ·{' '}
                          {req.isMandatory ? 'Mandatory' : 'Conditional'} ·{' '}
                          {req.conditionNote}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Rule Authoring Editor Panel */}
          {showRuleEditor && (
            <form
              onSubmit={handleSaveRule}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-semibold">
                    {editingRuleId ? 'Edit Draft Country Visa Rule' : 'Author New Country Visa Rule'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Saved as Draft. Submit for review and approve before cases consume this checklist specification.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRuleEditor(false)}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label htmlFor="rule-country" className="text-xs font-medium">
                    Destination Country
                  </label>
                  <select
                    id="rule-country"
                    disabled={Boolean(editingRuleId)}
                    value={ruleCountry}
                    onChange={(e) => setRuleCountry(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="rule-category" className="text-xs font-medium">
                    Visa Category
                  </label>
                  <select
                    id="rule-category"
                    disabled={Boolean(editingRuleId)}
                    value={ruleCategory}
                    onChange={(e) => setRuleCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    {categories.map((cat) => (
                      <option key={cat.code} value={cat.code}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="rule-version" className="text-xs font-medium">
                    Rule Version
                  </label>
                  <input
                    id="rule-version"
                    type="text"
                    required
                    value={ruleVersion}
                    onChange={(e) => setRuleVersion(e.target.value)}
                    placeholder="2026.2-custom"
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="rule-title" className="text-xs font-medium">
                    Route / Rule Title
                  </label>
                  <input
                    id="rule-title"
                    type="text"
                    required
                    value={ruleTitle}
                    onChange={(e) => setRuleTitle(e.target.value)}
                    placeholder="e.g. Germany Business Short-Stay (Schengen C)"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="rule-source-url" className="text-xs font-medium">
                    Official Government / Consulate URL
                  </label>
                  <input
                    id="rule-source-url"
                    type="url"
                    value={ruleSourceUrl}
                    onChange={(e) => setRuleSourceUrl(e.target.value)}
                    placeholder="https://auswaertiges-amt.de/..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="space-y-1">
                  <label htmlFor="rule-effective" className="text-xs font-medium">
                    Effective From
                  </label>
                  <input
                    id="rule-effective"
                    type="date"
                    required
                    value={ruleEffectiveFrom}
                    onChange={(e) => setRuleEffectiveFrom(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs pt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ruleIsDemo}
                    onChange={(e) => setRuleIsDemo(e.target.checked)}
                  />
                  <span>Mark as Demonstration / Internal Template Rule</span>
                </label>
                {currentUser.isPlatformAdmin && !editingRuleId && (
                  <div className="space-y-1">
                    <label htmlFor="rule-scope" className="text-xs font-medium">
                      Visibility Scope
                    </label>
                    <select
                      id="rule-scope"
                      value={ruleScope}
                      onChange={(e) =>
                        setRuleScope(e.target.value as 'ORGANIZATION' | 'GLOBAL')
                      }
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                    >
                      <option value="ORGANIZATION">Active Tenant Only</option>
                      <option value="GLOBAL">Global Platform Catalog</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="rule-summary" className="text-xs font-medium">
                  Eligibility &amp; Policy Summary
                </label>
                <textarea
                  id="rule-summary"
                  rows={2}
                  required
                  value={ruleSummary}
                  onChange={(e) => setRuleSummary(e.target.value)}
                  placeholder="Summarize stay limits, eligibility scope, and consular filing policy..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>

              {/* Checklist Requirement Builder */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold">
                    Automated Document Checklist Rules ({ruleRequirements.length})
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setRuleRequirements((prev) => [
                        ...prev,
                        {
                          ...EMPTY_REQUIREMENT,
                          requirementCode: `CUSTOM_DOC_${prev.length + 1}`,
                          title: '',
                          description: '',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Requirement</span>
                  </button>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {ruleRequirements.map((req, idx) => (
                    <div key={idx} className="py-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs text-slate-500">Code</label>
                        <input
                          type="text"
                          required
                          value={req.requirementCode}
                          onChange={(e) => {
                            const next = [...ruleRequirements];
                            next[idx] = { ...next[idx], requirementCode: e.target.value };
                            setRuleRequirements(next);
                          }}
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                        />
                      </div>
                      <div className="md:col-span-3 space-y-1">
                        <label className="text-xs text-slate-500">Document Title</label>
                        <input
                          type="text"
                          required
                          value={req.title}
                          onChange={(e) => {
                            const next = [...ruleRequirements];
                            next[idx] = { ...next[idx], title: e.target.value };
                            setRuleRequirements(next);
                          }}
                          placeholder="e.g. Signed Sponsorship Letter"
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                        />
                      </div>
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs text-slate-500">Type</label>
                        <select
                          value={req.documentType}
                          onChange={(e) => {
                            const next = [...ruleRequirements];
                            next[idx] = { ...next[idx], documentType: e.target.value };
                            setRuleRequirements(next);
                          }}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                        >
                          {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs text-slate-500">Trigger Condition</label>
                        <select
                          value={req.conditionType || 'ALWAYS'}
                          onChange={(e) => {
                            const next = [...ruleRequirements];
                            next[idx] = {
                              ...next[idx],
                              conditionType: e.target.value as RuleConditionType,
                            };
                            setRuleRequirements(next);
                          }}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                        >
                          {Object.entries(CONDITION_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2 flex items-center gap-2 pb-1.5">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={req.isMandatory}
                            onChange={(e) => {
                              const next = [...ruleRequirements];
                              next[idx] = { ...next[idx], isMandatory: e.target.checked };
                              setRuleRequirements(next);
                            }}
                          />
                          <span>Mandatory</span>
                        </label>
                      </div>
                      <div className="md:col-span-1 flex justify-end pb-1">
                        {ruleRequirements.length > 1 && (
                          <button
                            type="button"
                            aria-label="Remove requirement"
                            onClick={() =>
                              setRuleRequirements((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap cursor-pointer"
                >
                  {editingRuleId ? 'Save Draft Rule' : 'Create Draft Rule'}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        /* Dynamic Visa Form Builder Tab */
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Schema Catalog List */}
            <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Dynamic Visa Form Schemas</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    JSON Schema 2020-12 definitions driving multi-step case intake &amp; AI prefill.
                  </p>
                </div>
                {canAuthor && (
                  <button
                    type="button"
                    onClick={openNewFormSchema}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Form Schema</span>
                  </button>
                )}
              </div>

              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {schemas.map((s) => {
                  const isSelected = selectedSchema?.id === s.id && !showFormCreator;
                  const canMutateOrg =
                    canAuthor && (Boolean(s.organizationId) || currentUser.isPlatformAdmin);
                  return (
                    <div
                      key={s.id}
                      className={`p-4 space-y-2 transition-colors ${
                        isSelected ? 'bg-slate-50 dark:bg-slate-800/50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowFormCreator(false);
                            setSelectedSchemaId(s.id);
                            setPreviewStepIndex(0);
                          }}
                          className="text-left space-y-0.5 min-w-0 cursor-pointer"
                        >
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {s.title}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono">{s.schemaKey}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{s.version}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {s.destinationCountry} / {s.visaCategoryCode}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className={`font-medium ${statusSemanticTone(s.approvalStatus)}`}>
                              {APPROVAL_LABELS[s.approvalStatus]}
                            </span>
                          </div>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-500 tabular-nums">
                          {s.schema.steps.length} steps · {Object.keys(s.schema.properties).length}{' '}
                          fields
                        </span>
                        {canMutateOrg && ['DRAFT', 'IN_REVIEW'].includes(s.approvalStatus) && (
                          <button
                            type="button"
                            onClick={() => openEditOrCloneSchema(s, false)}
                            className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                          >
                            Edit
                          </button>
                        )}
                        {canAuthor && (
                          <button
                            type="button"
                            onClick={() => openEditOrCloneSchema(s, true)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                            <span>Clone</span>
                          </button>
                        )}
                        {canMutateOrg && s.approvalStatus === 'DRAFT' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleTransitionFormSchema(s.id, 'IN_REVIEW')}
                            className="px-2 py-1 text-xs text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-md cursor-pointer"
                          >
                            Submit Review
                          </button>
                        )}
                        {canReview &&
                          (Boolean(s.organizationId) || currentUser.isPlatformAdmin) &&
                          s.approvalStatus === 'IN_REVIEW' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleTransitionFormSchema(s.id, 'PUBLISHED')}
                              className="px-2 py-1 text-xs text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer"
                            >
                              Publish Schema
                            </button>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Schema Editor OR Interactive Multi-Step Preview */}
            <div className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
              {showFormCreator ? (
                <form onSubmit={handleSaveFormSchema} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        {editingFormId
                          ? 'Edit Draft Dynamic Form Schema'
                          : 'Author New Dynamic Form Schema'}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Define wizard steps, field types, conditional visibility rules, and AI prefill eligibility.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setFormEditorMode((m) => (m === 'edit' ? 'preview' : 'edit'))
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{formEditorMode === 'edit' ? 'Live Preview' : 'Back to Builder'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowFormCreator(false)}
                        className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>

                  {formEditorMode === 'edit' ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label htmlFor="fschema-title" className="text-xs font-medium">
                            Schema Title
                          </label>
                          <input
                            id="fschema-title"
                            type="text"
                            required
                            value={schemaTitle}
                            onChange={(e) => setSchemaTitle(e.target.value)}
                            placeholder="e.g. Germany Business Short-Stay Custom Form"
                            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label htmlFor="fschema-key" className="text-xs font-medium">
                              Schema Key
                            </label>
                            <input
                              id="fschema-key"
                              type="text"
                              required
                              disabled={Boolean(editingFormId)}
                              value={schemaKey}
                              onChange={(e) => setSchemaKey(e.target.value)}
                              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                            />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor="fschema-ver" className="text-xs font-medium">
                              Version
                            </label>
                            <input
                              id="fschema-ver"
                              type="text"
                              required
                              value={schemaVersion}
                              onChange={(e) => setSchemaVersion(e.target.value)}
                              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label htmlFor="fschema-country" className="text-xs font-medium">
                            Target Country
                          </label>
                          <select
                            id="fschema-country"
                            value={schemaCountry}
                            onChange={(e) => setSchemaCountry(e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                          >
                            <option value="*">Universal (*)</option>
                            {countries.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.name} ({c.code})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="fschema-category" className="text-xs font-medium">
                            Visa Category
                          </label>
                          <select
                            id="fschema-category"
                            value={schemaCategory}
                            onChange={(e) => setSchemaCategory(e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                          >
                            <option value="*">Universal (*)</option>
                            {categories.map((cat) => (
                              <option key={cat.code} value={cat.code}>
                                {cat.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-xs pt-5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={schemaIsDemo}
                            onChange={(e) => setSchemaIsDemo(e.target.checked)}
                          />
                          <span>Demo / Template Schema</span>
                        </label>
                      </div>

                      {/* Wizard Steps */}
                      <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold">
                            Wizard Steps ({schemaSteps.length})
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setSchemaSteps((prev) => [
                                ...prev,
                                {
                                  id: `step_${prev.length + 1}`,
                                  title: `Step ${prev.length + 1}`,
                                  description: 'Additional route questions.',
                                  order: prev.length,
                                },
                              ])
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add Step</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {schemaSteps.map((st, idx) => (
                            <div
                              key={idx}
                              className="p-2.5 border border-slate-200 dark:border-slate-700 rounded-lg space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <input
                                  type="text"
                                  aria-label={`Step ${idx + 1} ID`}
                                  value={st.id}
                                  onChange={(e) => {
                                    const next = [...schemaSteps];
                                    next[idx] = { ...next[idx], id: e.target.value };
                                    setSchemaSteps(next);
                                  }}
                                  className="w-28 px-2 py-1 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                                />
                                {schemaSteps.length > 1 && (
                                  <button
                                    type="button"
                                    aria-label="Delete step"
                                    onClick={() =>
                                      setSchemaSteps((prev) => prev.filter((_, i) => i !== idx))
                                    }
                                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                              <input
                                type="text"
                                aria-label={`Step ${idx + 1} Title`}
                                value={st.title}
                                onChange={(e) => {
                                  const next = [...schemaSteps];
                                  next[idx] = { ...next[idx], title: e.target.value };
                                  setSchemaSteps(next);
                                }}
                                className="w-full px-2 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Form Fields */}
                      <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold">
                            Schema Fields ({schemaFields.length})
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setSchemaFields((prev) => [
                                ...prev,
                                {
                                  key: `customField${prev.length + 1}`,
                                  spec: {
                                    type: 'string',
                                    title: '',
                                    stepId: schemaSteps[0]?.id || 'identity',
                                    required: false,
                                  },
                                },
                              ])
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add Field</span>
                          </button>
                        </div>

                        <div className="divide-y divide-slate-200 dark:divide-slate-800">
                          {schemaFields.map((f, idx) => (
                            <div
                              key={idx}
                              className="py-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 items-center"
                            >
                              <input
                                type="text"
                                aria-label={`Field ${idx + 1} Key`}
                                value={f.key}
                                onChange={(e) => {
                                  const next = [...schemaFields];
                                  next[idx] = { ...next[idx], key: e.target.value };
                                  setSchemaFields(next);
                                }}
                                placeholder="fieldKey"
                                className="md:col-span-3 px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                              />
                              <input
                                type="text"
                                aria-label={`Field ${idx + 1} Label`}
                                value={f.spec.title}
                                onChange={(e) => {
                                  const next = [...schemaFields];
                                  next[idx] = {
                                    ...next[idx],
                                    spec: { ...next[idx].spec, title: e.target.value },
                                  };
                                  setSchemaFields(next);
                                }}
                                placeholder="Display Label"
                                className="md:col-span-3 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                              />
                              <select
                                aria-label={`Field ${idx + 1} Type`}
                                value={f.spec.type}
                                onChange={(e) => {
                                  const next = [...schemaFields];
                                  next[idx] = {
                                    ...next[idx],
                                    spec: {
                                      ...next[idx].spec,
                                      type: e.target.value as JsonSchemaFieldSpec['type'],
                                    },
                                  };
                                  setSchemaFields(next);
                                }}
                                className="md:col-span-2 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                              >
                                <option value="string">Text</option>
                                <option value="date">Date</option>
                                <option value="number">Number</option>
                                <option value="boolean">Yes/No</option>
                              </select>
                              <select
                                aria-label={`Field ${idx + 1} Step`}
                                value={f.spec.stepId}
                                onChange={(e) => {
                                  const next = [...schemaFields];
                                  next[idx] = {
                                    ...next[idx],
                                    spec: { ...next[idx].spec, stepId: e.target.value },
                                  };
                                  setSchemaFields(next);
                                }}
                                className="md:col-span-2 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                              >
                                {schemaSteps.map((st) => (
                                  <option key={st.id} value={st.id}>
                                    {st.title}
                                  </option>
                                ))}
                              </select>
                              <div className="md:col-span-2 flex items-center justify-between gap-2">
                                <label className="flex items-center gap-1 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(f.spec.required)}
                                    onChange={(e) => {
                                      const next = [...schemaFields];
                                      next[idx] = {
                                        ...next[idx],
                                        spec: { ...next[idx].spec, required: e.target.checked },
                                      };
                                      setSchemaFields(next);
                                    }}
                                  />
                                  <span>Req</span>
                                </label>
                                <label className="flex items-center gap-1 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(f.spec.aiSuggestible)}
                                    onChange={(e) => {
                                      const next = [...schemaFields];
                                      next[idx] = {
                                        ...next[idx],
                                        spec: {
                                          ...next[idx].spec,
                                          aiSuggestible: e.target.checked,
                                        },
                                      };
                                      setSchemaFields(next);
                                    }}
                                  />
                                  <span>AI</span>
                                </label>
                                {schemaFields.length > 1 && (
                                  <button
                                    type="button"
                                    aria-label="Delete field"
                                    onClick={() =>
                                      setSchemaFields((prev) => prev.filter((_, i) => i !== idx))
                                    }
                                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end pt-2">
                        <button
                          type="submit"
                          disabled={busy}
                          className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                        >
                          {editingFormId ? 'Save Draft Form Schema' : 'Create Draft Form Schema'}
                        </button>
                      </div>
                    </>
                  ) : null}
                </form>
              ) : null}

              {/* Live Interactive Multi-Step Schema Preview */}
              {(!showFormCreator || formEditorMode === 'preview') && activePreviewSchema && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <FileText className="w-4 h-4 text-slate-500" />
                        <span>{activePreviewSchema.title}</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Interactive Schema Preview · Conditional fields update live based on test answers.
                      </p>
                    </div>
                  </div>

                  {previewSteps.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                      {previewSteps.map((st, idx) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setPreviewStepIndex(idx)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            safePreviewStepIdx === idx
                              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {idx + 1}. {st.title}
                        </button>
                      ))}
                    </div>
                  )}

                  {currentPreviewStep && (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {currentPreviewStep.description}
                      </div>

                      <div className="space-y-3">
                        {Object.entries(activePreviewSchema.properties)
                          .filter(([, spec]) => spec.stepId === currentPreviewStep.id)
                          .filter(([, spec]) => {
                            if (!spec.visibleWhen) return true;
                            const dep = previewAnswers[spec.visibleWhen.field];
                            if (spec.visibleWhen.equals !== undefined) {
                              return dep === spec.visibleWhen.equals;
                            }
                            if (spec.visibleWhen.in) {
                              return spec.visibleWhen.in.includes(dep as any);
                            }
                            return Boolean(dep);
                          })
                          .map(([key, spec]) => (
                            <div key={key} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <label className="font-medium text-slate-900 dark:text-slate-100">
                                  {spec.title}
                                  {spec.required ? ' *' : ''}
                                </label>
                                <span className="text-slate-400 font-mono">
                                  {key}
                                  {spec.aiSuggestible ? ' · AI Prefill' : ''}
                                  {spec.sensitiveMasked ? ' · Masked' : ''}
                                </span>
                              </div>
                              {spec.type === 'boolean' ? (
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(previewAnswers[key])}
                                    onChange={(e) =>
                                      setPreviewAnswers((p) => ({
                                        ...p,
                                        [key]: e.target.checked,
                                      }))
                                    }
                                  />
                                  <span>Yes / Applicable</span>
                                </label>
                              ) : spec.enum ? (
                                <select
                                  value={String(previewAnswers[key] || '')}
                                  onChange={(e) =>
                                    setPreviewAnswers((p) => ({
                                      ...p,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                                >
                                  <option value="">Select option...</option>
                                  {spec.enum.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              ) : spec.format === 'textarea' ? (
                                <textarea
                                  rows={2}
                                  value={String(previewAnswers[key] || '')}
                                  onChange={(e) =>
                                    setPreviewAnswers((p) => ({
                                      ...p,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  placeholder={spec.placeholder || 'Applicant narrative preview...'}
                                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                                />
                              ) : (
                                <input
                                  type={
                                    spec.type === 'date'
                                      ? 'date'
                                      : spec.type === 'number'
                                        ? 'number'
                                        : 'text'
                                  }
                                  value={String(previewAnswers[key] || '')}
                                  onChange={(e) =>
                                    setPreviewAnswers((p) => ({
                                      ...p,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  placeholder={spec.placeholder || ''}
                                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                                />
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
