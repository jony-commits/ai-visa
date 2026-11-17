import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileCode2,
  History,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { apiRequest, getStoredToken } from '../lib/api';
import {
  ApplicationFormDetail,
  AuthUser,
  FieldCondition,
  FormRevisionItem,
  formatShortDate,
  statusSemanticTone,
  SubmissionCapabilityReport,
  SubmissionHandoffItem,
  VisaFormJsonSchema,
} from '../types';

interface CaseFormPanelProps {
  caseId: string;
  currentUser: AuthUser;
  applicantUserId: string;
  onUpdated?: () => void;
}

function evaluateConditionClient(
  cond: FieldCondition | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!cond) return true;
  const val = answers[cond.field];
  if (cond.equals !== undefined) return val === cond.equals;
  if (cond.in !== undefined) return cond.in.includes(val as string | boolean | number);
  if (cond.truthy) return Boolean(val);
  return true;
}

export const CaseFormPanel: React.FC<CaseFormPanelProps> = ({
  caseId,
  currentUser,
  applicantUserId,
  onUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [schema, setSchema] = useState<VisaFormJsonSchema | null>(null);
  const [form, setForm] = useState<ApplicationFormDetail | null>(null);
  const [revisions, setRevisions] = useState<FormRevisionItem[]>([]);
  const [capabilities, setCapabilities] = useState<SubmissionCapabilityReport[]>([]);
  const [handoffs, setHandoffs] = useState<SubmissionHandoffItem[]>([]);

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [autosaveLabel, setAutosaveLabel] = useState<string>('Synced');
  const [busy, setBusy] = useState(false);

  const [attestationChecked, setAttestationChecked] = useState(false);
  const [manualConfirmRefs, setManualConfirmRefs] = useState<Record<string, string>>({});

  const autosaveTimerRef = useRef<number | null>(null);
  const isOwningApplicant =
    currentUser.userId === applicantUserId || currentUser.isPlatformAdmin;

  const loadForm = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        schema: VisaFormJsonSchema;
        form: ApplicationFormDetail;
        revisions: FormRevisionItem[];
        submissionCapabilities: SubmissionCapabilityReport[];
        handoffs: SubmissionHandoffItem[];
      }>(`/api/cases/${caseId}/forms`);

      setSchema(res.schema);
      setForm(res.form);
      setAnswers(res.form.answers || {});
      setActiveStepIdx(res.form.currentStep || 0);
      setRevisions(res.revisions || []);
      setCapabilities(res.submissionCapabilities || []);
      setHandoffs(res.handoffs || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load dynamic visa form');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadForm();
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [loadForm]);

  function scheduleAutosave(nextAnswers: Record<string, unknown>, stepIdx: number) {
    setAutosaveLabel('Unsaved changes...');
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(async () => {
      setAutosaveLabel('Auto-saving...');
      try {
        const res = await apiRequest<{
          detail: {
            form: ApplicationFormDetail;
            revisions: FormRevisionItem[];
          };
        }>(`/api/cases/${caseId}/forms/draft`, {
          method: 'PUT',
          body: { answers: nextAnswers, currentStep: stepIdx, isAutosave: true },
        });
        setForm(res.detail.form);
        setAutosaveLabel(
          `Auto-saved at ${new Date().toISOString().slice(11, 19)} UTC`,
        );
      } catch {
        setAutosaveLabel('Auto-save failed');
      }
    }, 800);
  }

  function updateField(key: string, value: unknown) {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    scheduleAutosave(next, activeStepIdx);
  }

  async function handleSaveRevision() {
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        approvalReset: boolean;
        detail: { form: ApplicationFormDetail; revisions: FormRevisionItem[] };
      }>(`/api/cases/${caseId}/forms/draft`, {
        method: 'PUT',
        body: {
          answers,
          currentStep: activeStepIdx,
          isAutosave: false,
          changeReason: 'Saved step snapshot',
        },
      });
      setForm(res.detail.form);
      setRevisions(res.detail.revisions);
      setAutosaveLabel('Revision saved');
      setNotice(
        res.approvalReset
          ? 'Revision saved. Because answers changed, prior applicant approval was reset and requires re-approval.'
          : `Saved Revision #${res.detail.form.revisionNumber}.`,
      );
    } catch (err: any) {
      setError(err.message || 'Failed to save form revision');
    } finally {
      setBusy(false);
    }
  }

  async function handlePrefillVerified() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        filledKeys: string[];
        detail: { form: ApplicationFormDetail; revisions: FormRevisionItem[] };
      }>(`/api/cases/${caseId}/forms/prefill`, {
        method: 'POST',
        body: { overwriteExisting: false },
      });
      setForm(res.detail.form);
      setAnswers(res.detail.form.answers);
      setRevisions(res.detail.revisions);
      setNotice(
        res.filledKeys.length > 0
          ? `Prefilled ${res.filledKeys.length} field(s) from verified applicant profile, encrypted passport record, and confirmed documents.`
          : 'No empty verified fields required prefilling.',
      );
    } catch (err: any) {
      setError(err.message || 'Verified prefill failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateAiSuggestions() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        form: ApplicationFormDetail;
        revisions: FormRevisionItem[];
      }>(`/api/cases/${caseId}/forms/ai-suggest`, {
        method: 'POST',
      });
      setForm(res.form);
      setNotice(
        'AI draft suggestions generated. Every suggestion is clearly marked "Review Required" and must be explicitly accepted or dismissed.',
      );
    } catch (err: any) {
      setError(err.message || 'AI suggestion request blocked or failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSuggestionDecision(
    fieldKey: string,
    decision: 'ACCEPT' | 'DISMISS',
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{
        form: ApplicationFormDetail;
        revisions: FormRevisionItem[];
      }>(`/api/cases/${caseId}/forms/ai-suggestions/${fieldKey}`, {
        method: 'PATCH',
        body: { decision },
      });
      setForm(res.form);
      setAnswers(res.form.answers);
      setRevisions(res.revisions);
    } catch (err: any) {
      setError(err.message || 'Failed to update AI suggestion');
    } finally {
      setBusy(false);
    }
  }

  async function handleApplicantApprove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        form: ApplicationFormDetail;
        revisions: FormRevisionItem[];
      }>(`/api/cases/${caseId}/forms/approve`, {
        method: 'POST',
        body: { attestationAccepted: attestationChecked },
      });
      setForm(res.form);
      setRevisions(res.revisions);
      setNotice('Applicant declaration approved and locked for submission handoff.');
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Form approval failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(format: 'json' | 'html') {
    setError(null);
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/cases/${caseId}/forms/export?format=${format}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `visa-form-${caseId}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to export application form');
    }
  }

  async function handleCreateHandoff(
    mode: 'AUTHORIZED_OFFICIAL_API' | 'GUIDED_MANUAL_HANDOFF',
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/cases/${caseId}/submission/handoff`, {
        method: 'POST',
        body: { mode },
      });
      setNotice(
        'Guided submission handoff package generated from applicant-approved form data.',
      );
      await loadForm();
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Submission handoff generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmManualSubmission(handoffId: string) {
    const refVal = manualConfirmRefs[handoffId]?.trim();
    if (!refVal) {
      setError('Enter the external portal confirmation receipt number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/cases/${caseId}/submission/${handoffId}/confirm-manual`, {
        method: 'POST',
        body: { externalConfirmationRef: refVal },
      });
      setNotice(`External submission reference "${refVal}" recorded with verified provenance.`);
      await loadForm();
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to confirm external reference');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !schema || !form) {
    return (
      <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500 dark:text-slate-400">
        Loading versioned JSON Schema visa form...
      </div>
    );
  }

  const steps = schema.steps.slice().sort((a, b) => a.order - b.order);
  const currentStep = steps[activeStepIdx] || steps[0];
  const stepFields = Object.entries(schema.properties).filter(
    ([, spec]) =>
      spec.stepId === currentStep.id && evaluateConditionClient(spec.visibleWhen, answers),
  );
  const pendingAiCount = Object.values(form.aiSuggestions).filter(
    (s) => s.status === 'PENDING_REVIEW',
  ).length;

  return (
    <div className="space-y-6">
      {/* Top Schema Provenance & Progress Bar */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold">{schema.title}</h2>
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
              Schema: {schema.schemaKey} · Version: {schema.version} · Revision #{form.revisionNumber} ·{' '}
              {autosaveLabel}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrefillVerified}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              Prefill Verified Data
            </button>
            <button
              type="button"
              onClick={handleGenerateAiSuggestions}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
              Generate AI Draft Suggestions
            </button>
            <button
              type="button"
              onClick={() => handleExport('json')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => handleExport('html')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Printable Summary
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400">Required Visible Fields</div>
            <div className="font-mono tabular-nums font-semibold">
              {form.completedRequiredFields} / {form.totalRequiredVisible} completed
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Pending AI Suggestions</div>
            <div
              className={`font-mono tabular-nums font-semibold ${
                pendingAiCount > 0 ? 'text-amber-700 dark:text-amber-400' : ''
              }`}
            >
              {pendingAiCount} awaiting review
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Schema Completeness</div>
            <div
              className={`font-semibold ${
                form.isComplete
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {form.isComplete ? 'Complete & Valid' : `${form.missingRequiredCount} issue(s) remaining`}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Applicant Approval</div>
            <div
              className={`font-semibold ${
                form.applicantApproved
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {form.applicantApproved
                ? `Approved (${formatShortDate(form.applicantApprovedAt)})`
                : 'Awaiting Applicant Sign-Off'}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-lg border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {/* Multi-Step Dynamic Form */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {/* Stepper Bar */}
        <div className="border-b border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
          {steps.map((step, idx) => {
            const active = idx === activeStepIdx;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStepIdx(idx)}
                className={`p-4 text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-slate-50 dark:bg-slate-800/60'
                    : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                }`}
              >
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  Step {idx + 1} of {steps.length}
                </div>
                <div className="text-xs font-semibold mt-0.5">{step.title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {step.description}
                </div>
              </button>
            );
          })}
        </div>

        {/* Dynamic Conditional Fields */}
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stepFields.map(([key, spec]) => {
              const val = answers[key];
              const isRequired =
                Boolean(spec.required || schema.required.includes(key)) ||
                (spec.requiredWhen ? evaluateConditionClient(spec.requiredWhen, answers) : false);
              const source = form.sourceAttribution[key];
              const suggestion = form.aiSuggestions[key];
              const isWide = spec.format === 'textarea';

              const fieldId = `form-field-${key}`;

              return (
                <div key={key} className={`space-y-1.5 ${isWide ? 'md:col-span-2' : ''}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <label
                      htmlFor={fieldId}
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      {spec.title}
                      {isRequired ? ' *' : ''}
                    </label>
                    {source && (
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {source}
                      </span>
                    )}
                  </div>

                  {spec.type === 'boolean' ? (
                    <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs cursor-pointer">
                      <input
                        id={fieldId}
                        type="checkbox"
                        checked={Boolean(val)}
                        onChange={(e) => updateField(key, e.target.checked)}
                      />
                      <span>{val ? 'Yes' : 'No'}</span>
                    </label>
                  ) : spec.enum ? (
                    <select
                      id={fieldId}
                      value={String(val || '')}
                      onChange={(e) => updateField(key, e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">Select an option...</option>
                      {spec.enum.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : spec.format === 'textarea' ? (
                    <textarea
                      id={fieldId}
                      rows={3}
                      value={String(val || '')}
                      onChange={(e) => updateField(key, e.target.value)}
                      placeholder={spec.placeholder || ''}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  ) : (
                    <input
                      id={fieldId}
                      type={spec.type === 'date' ? 'date' : spec.type === 'number' ? 'number' : 'text'}
                      value={val === undefined || val === null ? '' : String(val)}
                      onChange={(e) =>
                        updateField(
                          key,
                          spec.type === 'number'
                            ? e.target.value === ''
                              ? ''
                              : Number(e.target.value)
                            : e.target.value,
                        )
                      }
                      placeholder={spec.placeholder || ''}
                      className={`w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 ${
                        spec.type === 'date' || spec.type === 'number' || spec.format === 'country'
                          ? 'font-mono'
                          : ''
                      }`}
                    />
                  )}

                  {/* AI Draft Suggestion Banner (Review Required) */}
                  {suggestion && suggestion.status === 'PENDING_REVIEW' && (
                    <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-amber-900 dark:text-amber-200">
                          AI Suggestion — Review Required
                        </span>
                        <span className="font-mono text-amber-800 dark:text-amber-300 tabular-nums">
                          {suggestion.model} · Confidence {(suggestion.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                        {suggestion.suggestedValue}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400">
                        Rationale: {suggestion.rationale}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleSuggestionDecision(key, 'ACCEPT')}
                          disabled={busy}
                          className="px-3 py-1 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded cursor-pointer"
                        >
                          Accept Suggestion
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSuggestionDecision(key, 'DISMISS')}
                          disabled={busy}
                          className="px-3 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                disabled={activeStepIdx === 0}
                onClick={() => setActiveStepIdx((i) => Math.max(0, i - 1))}
                className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                Previous Step
              </button>
              <button
                type="button"
                disabled={activeStepIdx >= steps.length - 1}
                onClick={() => setActiveStepIdx((i) => Math.min(steps.length - 1, i + 1))}
                className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                Next Step
              </button>
            </div>

            <button
              type="button"
              onClick={handleSaveRevision}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Save Step Revision
            </button>
          </div>
        </div>
      </section>

      {/* Applicant Final Approval Section */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">
            Applicant Declaration & Approval
          </h3>
          {form.applicantApproved && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              Approved ({formatShortDate(form.applicantApprovedAt)})
            </span>
          )}
        </div>

        {form.applicantApproved ? (
          <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-900 dark:text-emerald-200">
            <strong>Declaration Signed:</strong> {form.applicantAttestationText} (Revision #
            {form.revisionNumber}). Any subsequent form edit will clear approval and require re-confirmation.
          </div>
        ) : isOwningApplicant ? (
          <form onSubmit={handleApplicantApprove} className="space-y-3">
            <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={attestationChecked}
                onChange={(e) => setAttestationChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I confirm that all entries in this form—including prefilled data and any AI draft suggestions I chose to accept—are complete, accurate, and truthful.
              </span>
            </label>
            <button
              type="submit"
              disabled={busy || !attestationChecked || !form.isComplete || pendingAiCount > 0}
              className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-40 cursor-pointer"
            >
              Approve Complete Application Form
            </button>
            {(!form.isComplete || pendingAiCount > 0) && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Complete all mandatory visible fields and accept or dismiss all AI suggestions before approving.
              </p>
            )}
          </form>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Consultants and agency staff cannot sign the applicant declaration. Share the draft for the applicant to review and approve.
          </p>
        )}
      </section>

      {/* Authorized Submission Adapter & Guided Manual Handoff */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="space-y-1">
          <h3 className="font-display text-base font-semibold">
            Submission Adapter & Portal Handoff
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Supports authorized official consular APIs when contracted, or guided manual portal handoffs. Restricted portals and CAPTCHA/MFA challenges are never automated.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {capabilities.map((cap) => (
            <div
              key={cap.adapterId}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5 flex flex-col justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{cap.displayName}</span>
                  <span
                    className={`text-xs font-mono font-medium ${
                      cap.available
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {cap.available ? 'AVAILABLE' : 'NOT_CONFIGURED'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">{cap.reason}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Policy: {cap.automationPolicy}
                </p>
              </div>
              <button
                type="button"
                disabled={busy || !cap.available || !form.applicantApproved}
                onClick={() => handleCreateHandoff(cap.mode)}
                className="w-full py-2 px-3 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                {cap.mode === 'AUTHORIZED_OFFICIAL_API'
                  ? 'Submit via Authorized API'
                  : 'Generate Guided Manual Handoff Package'}
              </button>
            </div>
          ))}
        </div>

        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
          <span>
            Portal Compliance Guarantee: Headless browser scraping, credential stuffing, and CAPTCHA/anti-bot bypasses are disabled at the architecture layer.
          </span>
        </div>

        {/* Active Handoff Packages */}
        {handoffs.length > 0 && (
          <div className="space-y-4 pt-2">
            {handoffs.map((h) => (
              <div
                key={h.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold">
                    {h.submission_mode} ·{' '}
                    <span className={statusSemanticTone(h.status)}>{h.status}</span>
                  </div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {formatShortDate(h.created_at)}
                    {h.external_confirmation_ref ? ` · Ref: ${h.external_confirmation_ref}` : ''}
                  </div>
                </div>

                {h.handoffPackage?.checklistSteps && (
                  <ol className="list-decimal pl-5 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                    {h.handoffPackage.checklistSteps.map((stepLine, idx) => (
                      <li key={idx}>{stepLine}</li>
                    ))}
                  </ol>
                )}

                {h.external_portal_url && (
                  <div className="text-xs">
                    <a
                      href={h.external_portal_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      Open Official Destination Guidance
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                {h.status === 'HANDOFF_PACKAGE_READY' && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-2 items-center">
                    <input
                      type="text"
                      value={manualConfirmRefs[h.id] || ''}
                      onChange={(e) =>
                        setManualConfirmRefs((prev) => ({ ...prev, [h.id]: e.target.value }))
                      }
                      placeholder="Enter official confirmation receipt #"
                      className="flex-1 min-w-[220px] px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                    <button
                      type="button"
                      onClick={() => handleConfirmManualSubmission(h.id)}
                      disabled={busy}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                    >
                      Record External Filing Receipt
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Form Revision History */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          <h3 className="font-display text-sm font-semibold">Form Revision History</h3>
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
          {revisions.map((rev) => (
            <div key={rev.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono font-medium">Rev #{rev.revision_number}</span> ·{' '}
                <span>{rev.change_reason || 'Updated form'}</span>
              </div>
              <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {rev.changed_by_name} · {formatShortDate(rev.created_at)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
