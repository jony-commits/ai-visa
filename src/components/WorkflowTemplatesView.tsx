import React, { useCallback, useEffect, useState } from 'react';
import { Bell, GitBranch, Play, RefreshCw, Save } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  InternalCaseStatus,
  NotificationJobItem,
  NotificationTemplateItem,
  STATUS_LABELS,
  statusSemanticTone,
  WorkflowStageConfigItem,
} from '../types';

interface WorkflowTemplatesViewProps {
  currentUser: AuthUser;
}

const VISA_CATEGORY_FILTERS = [
  { code: '*', label: 'All Visa Categories (Organization Default)' },
  { code: 'TOURIST', label: 'Tourist / Visitor' },
  { code: 'BUSINESS', label: 'Business Visitor' },
  { code: 'STUDENT', label: 'Student / Study' },
  { code: 'WORK', label: 'Work / Skilled Employment' },
  { code: 'FAMILY', label: 'Family / Dependent' },
  { code: 'TRANSIT', label: 'Transit' },
  { code: 'OTHER', label: 'Other Country-Specific' },
];

export const WorkflowTemplatesView: React.FC<WorkflowTemplatesViewProps> = ({ currentUser }) => {
  const [visaCategory, setVisaCategory] = useState<string>('*');
  const [stages, setStages] = useState<WorkflowStageConfigItem[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplateItem[]>([]);
  const [jobs, setJobs] = useState<NotificationJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [editingStage, setEditingStage] = useState<WorkflowStageConfigItem | null>(null);
  const [stageLabel, setStageLabel] = useState('');
  const [stageSla, setStageSla] = useState(72);
  const [stageEnabled, setStageEnabled] = useState(true);
  const [stageNotify, setStageNotify] = useState(true);
  const [stageApplicantAllowed, setStageApplicantAllowed] = useState(false);
  const [stageAllowedNext, setStageAllowedNext] = useState<InternalCaseStatus[]>([]);

  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplateItem | null>(null);
  const [tplSubject, setTplSubject] = useState('');
  const [tplBody, setTplBody] = useState('');
  const [tplActive, setTplActive] = useState(true);

  const [busy, setBusy] = useState(false);

  const isAdmin = currentUser.role === 'AGENCY_ADMIN' || currentUser.isPlatformAdmin;
  const isStaff = currentUser.role !== 'APPLICANT' || currentUser.isPlatformAdmin;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stageRes, tplRes, jobRes] = await Promise.all([
        apiRequest<{ stages: WorkflowStageConfigItem[] }>(
          `/api/workflows/stages?visaCategory=${encodeURIComponent(visaCategory)}`,
        ),
        apiRequest<{ templates: NotificationTemplateItem[] }>('/api/notifications/templates'),
        apiRequest<{ jobs: NotificationJobItem[] }>('/api/notifications'),
      ]);
      setStages(stageRes.stages);
      setTemplates(tplRes.templates);
      setJobs(jobRes.jobs);
    } catch (err: any) {
      setError(err.message || 'Failed to load workflow settings');
    } finally {
      setLoading(false);
    }
  }, [visaCategory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function startEditStage(s: WorkflowStageConfigItem) {
    setEditingStage(s);
    setStageLabel(s.displayLabel);
    setStageSla(s.slaHours);
    setStageEnabled(s.enabled);
    setStageNotify(s.notifyOnEnter);
    setStageApplicantAllowed(s.applicantAllowed);
    setStageAllowedNext(s.allowedNextStages);
  }

  function toggleNextStage(code: InternalCaseStatus) {
    setStageAllowedNext((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    );
  }

  async function saveStage(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStage) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{ stages: WorkflowStageConfigItem[] }>(
        `/api/workflows/stages/${editingStage.stageCode}`,
        {
          method: 'PATCH',
          body: {
            visaCategory,
            displayLabel: stageLabel,
            slaHours: Number(stageSla),
            enabled: stageEnabled,
            applicantAllowed: stageApplicantAllowed,
            allowedNextStages: stageAllowedNext,
            notifyOnEnter: stageNotify,
          },
        },
      );
      setStages(res.stages);
      setEditingStage(null);
      setBanner(
        `Updated workflow stage ${editingStage.stageCode} (${visaCategory === '*' ? 'Organization Default' : visaCategory}) for ${currentUser.organizationName}.`,
      );
    } catch (err: any) {
      setError(err.message || 'Unable to update workflow stage');
    } finally {
      setBusy(false);
    }
  }

  function startEditTemplate(t: NotificationTemplateItem) {
    setEditingTemplate(t);
    setTplSubject(t.subjectTemplate || '');
    setTplBody(t.bodyTemplate);
    setTplActive(t.isActive);
  }

  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTemplate) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      await apiRequest(
        `/api/notifications/templates/${editingTemplate.templateKey}/${editingTemplate.channel}`,
        {
          method: 'PATCH',
          body: {
            subjectTemplate: editingTemplate.channel === 'EMAIL' ? tplSubject : null,
            bodyTemplate: tplBody,
            isActive: tplActive,
          },
        },
      );
      setEditingTemplate(null);
      setBanner(`Saved ${editingTemplate.channel} template for ${editingTemplate.templateKey}.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update notification template');
    } finally {
      setBusy(false);
    }
  }

  async function handleRunWorker() {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{
        processed: number;
        delivered: number;
        retried: number;
        failedPermanent: number;
      }>('/api/notifications/run-worker', {
        method: 'POST',
        body: { forceDue: true },
      });
      setBanner(
        `Worker executed: ${res.delivered} delivered, ${res.retried} scheduled for backoff retry, ${res.failedPermanent} permanent failures.`,
      );
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Worker dispatch failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryJob(jobId: string, resetAttempts: boolean) {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      await apiRequest(`/api/notifications/${jobId}/retry`, {
        method: 'POST',
        body: { resetAttempts },
      });
      setBanner('Notification retry executed.');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Retry failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Workflow Configuration & Notification Templates
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Tenant-scoped workflow SLAs, Email/SMS templates, and BullMQ-compatible delivery retry queue for {currentUser.organizationName}.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-300">
          {error}
        </div>
      )}
      {banner && (
        <div className="p-3.5 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-900 dark:text-blue-200">
          {banner}
        </div>
      )}

      {loading ? (
        <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500">
          Loading organization workflow configuration...
        </div>
      ) : (
        <>
          {/* Workflow Stages Table */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-slate-500" />
                <h2 className="font-display text-base font-semibold">
                  Configurable Organization Workflow Stages
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={visaCategory}
                  onChange={(e) => {
                    setEditingStage(null);
                    setVisaCategory(e.target.value);
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {VISA_CATEGORY_FILTERS.map((cat) => (
                    <option key={cat.code} value={cat.code}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                {!isAdmin && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Read-only (Agency Admin role required to edit)
                  </span>
                )}
              </div>
            </div>

            {editingStage && (
              <form
                onSubmit={saveStage}
                className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 space-y-4 text-xs"
              >
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-4 space-y-1">
                    <label className="block font-medium text-slate-600 dark:text-slate-400">
                      Stage Label ({editingStage.stageCode})
                    </label>
                    <input
                      type="text"
                      required
                      value={stageLabel}
                      onChange={(e) => setStageLabel(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <label className="block font-medium text-slate-600 dark:text-slate-400">
                      SLA Hours
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8760}
                      value={stageSla}
                      onChange={(e) => setStageSla(Number(e.target.value))}
                      className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-3 flex flex-col gap-1.5 pb-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={stageEnabled}
                        onChange={(e) => setStageEnabled(e.target.checked)}
                      />
                      Stage enabled
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={stageNotify}
                        onChange={(e) => setStageNotify(e.target.checked)}
                      />
                      Notify on stage enter
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={stageApplicantAllowed}
                        onChange={(e) => setStageApplicantAllowed(e.target.checked)}
                      />
                      Applicant can transition here
                    </label>
                  </div>
                  <div className="sm:col-span-3 flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setEditingStage(null)}
                      className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-2 text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save Stage
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="font-medium text-slate-600 dark:text-slate-400">
                    Allowed Next Stages from {editingStage.stageCode}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {(Object.keys(STATUS_LABELS) as InternalCaseStatus[])
                      .filter((code) => code !== editingStage.stageCode)
                      .map((code) => (
                        <label
                          key={code}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={stageAllowedNext.includes(code)}
                            onChange={() => toggleNextStage(code)}
                          />
                          <span className="truncate">{STATUS_LABELS[code]}</span>
                        </label>
                      ))}
                  </div>
                </div>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-5 font-medium">Stage Code</th>
                    <th className="py-3 px-5 font-medium">Display Label</th>
                    <th className="py-3 px-5 font-medium">SLA Target</th>
                    <th className="py-3 px-5 font-medium">State</th>
                    <th className="py-3 px-5 font-medium">Alerts</th>
                    <th className="py-3 px-5 font-medium">Allowed Next Stages</th>
                    {isAdmin && <th className="py-3 px-5 font-medium text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {stages.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-5 font-mono font-medium">{s.stageCode}</td>
                      <td className="py-3 px-5 font-medium">{s.displayLabel}</td>
                      <td className="py-3 px-5 font-mono tabular-nums">{s.slaHours}h</td>
                      <td
                        className={`py-3 px-5 font-mono font-medium ${
                          s.enabled
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {s.enabled ? 'ENABLED' : 'DISABLED'}
                      </td>
                      <td className="py-3 px-5 font-mono">
                        {s.notifyOnEnter ? 'ON_ENTER' : 'MUTED'}
                      </td>
                      <td className="py-3 px-5 text-slate-500 dark:text-slate-400 font-mono">
                        {s.allowedNextStages.length > 0
                          ? s.allowedNextStages.join(', ')
                          : 'Terminal'}
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-5 text-right">
                          <button
                            type="button"
                            onClick={() => startEditStage(s)}
                            className="text-blue-700 dark:text-blue-400 hover:underline font-medium cursor-pointer"
                          >
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Notification Templates Section */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-slate-500" />
                <h2 className="font-display text-base font-semibold">
                  Email & SMS Notification Templates
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                Placeholders: {'{{referenceNumber}} {{recipientName}} {{stageLabel}} {{appointmentAt}} {{centerName}}'}
              </span>
            </div>

            {editingTemplate && (
              <form
                onSubmit={saveTemplate}
                className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 space-y-3 text-xs"
              >
                <div className="font-semibold">
                  Editing {editingTemplate.templateKey} ({editingTemplate.channel})
                </div>
                {editingTemplate.channel === 'EMAIL' && (
                  <div className="space-y-1">
                    <label className="block font-medium text-slate-600 dark:text-slate-400">
                      Email Subject Template
                    </label>
                    <input
                      type="text"
                      value={tplSubject}
                      onChange={(e) => setTplSubject(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="block font-medium text-slate-600 dark:text-slate-400">
                    Message Body Template
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={tplBody}
                    onChange={(e) => setTplBody(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tplActive}
                      onChange={(e) => setTplActive(e.target.checked)}
                    />
                    Template active
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingTemplate(null)}
                      className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-2 text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                    >
                      Save Override
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {templates.map((t) => (
                <div key={`${t.templateKey}:${t.channel}`} className="p-4 flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-[260px]">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-semibold">{t.templateKey}</span>
                      <span className="font-mono text-slate-500">{t.channel}</span>
                      <span className="font-mono text-blue-700 dark:text-blue-400">
                        {t.isCustomOverride ? 'TENANT_OVERRIDE' : 'SYSTEM_DEFAULT'}
                      </span>
                      <span
                        className={`font-mono ${
                          t.isActive
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {t.isActive ? 'ACTIVE' : 'DISABLED'}
                      </span>
                    </div>
                    {t.subjectTemplate && (
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        Subject: {t.subjectTemplate}
                      </div>
                    )}
                    <div className="text-slate-600 dark:text-slate-400">{t.bodyTemplate}</div>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => startEditTemplate(t)}
                      className="text-blue-700 dark:text-blue-400 hover:underline font-medium shrink-0 cursor-pointer"
                    >
                      Customize
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Tenant Notification Queue & Worker */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold">
                  Scheduled Notification Queue (BullMQ-Compatible Retries)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tracks Email/SMS schedules, applicant consent gating, exponential retry backoff, and permanent failure dead-lettering.
                </p>
              </div>
              {isStaff && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRunWorker}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run Worker Now
                </button>
              )}
            </div>

            {jobs.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
                No notification jobs queued in this tenant yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-5 font-medium">Channel & Template</th>
                      <th className="py-3 px-5 font-medium">Recipient</th>
                      <th className="py-3 px-5 font-medium">Status</th>
                      <th className="py-3 px-5 font-medium">Attempts</th>
                      <th className="py-3 px-5 font-medium">Scheduled For</th>
                      <th className="py-3 px-5 font-medium">BullMQ Job ID</th>
                      {isStaff && <th className="py-3 px-5 font-medium text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {jobs.map((j) => (
                      <tr key={j.id}>
                        <td className="py-3 px-5 font-mono">
                          <div>
                            {j.channel} · {j.templateKey}
                          </div>
                          {j.lastError && (
                            <div className="text-[11px] text-red-700 dark:text-red-400 font-sans mt-0.5">
                              {j.lastError}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-5 font-mono">{j.recipientContact}</td>
                        <td className={`py-3 px-5 font-mono font-medium ${statusSemanticTone(j.status)}`}>
                          {j.status}
                        </td>
                        <td className="py-3 px-5 font-mono tabular-nums">
                          {j.attempts}/{j.maxAttempts}
                        </td>
                        <td className="py-3 px-5 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {j.scheduledFor.replace('T', ' ').slice(0, 16)} UTC
                        </td>
                        <td className="py-3 px-5 font-mono text-slate-500 truncate max-w-[220px]">
                          {j.bullmqJobId || '—'}
                        </td>
                        {isStaff && (
                          <td className="py-3 px-5 text-right">
                            {(j.status === 'RETRY_WAIT' || j.status === 'FAILED_PERMANENT') && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  handleRetryJob(j.id, j.status === 'FAILED_PERMANENT')
                                }
                                className="text-blue-700 dark:text-blue-400 hover:underline font-medium cursor-pointer"
                              >
                                {j.status === 'FAILED_PERMANENT' ? 'Reset & Retry' : 'Retry Now'}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
