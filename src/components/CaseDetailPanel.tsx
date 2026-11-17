import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, Plus, Send, ShieldAlert } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  CaseHistoryItem,
  CaseNoteItem,
  CaseTaskItem,
  formatShortDate,
  InternalCaseStatus,
  OrganizationMember,
  STATUS_LABELS,
  statusSemanticTone,
  VisaCase,
} from '../types';
import { CaseDocumentsPanel } from './CaseDocumentsPanel';
import { CaseFormPanel } from './CaseFormPanel';
import { CaseTrackingPanel } from './CaseTrackingPanel';

interface CaseDetailPanelProps {
  caseId: string;
  currentUser: AuthUser;
  initialTab?: 'overview' | 'documents' | 'forms' | 'tracking';
  onBack: () => void;
  onUpdated: () => void;
}

export const CaseDetailPanel: React.FC<CaseDetailPanelProps> = ({
  caseId,
  currentUser,
  initialTab = 'overview',
  onBack,
  onUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'forms' | 'tracking'>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<(VisaCase & { official_source_url?: string }) | null>(null);
  const [applicantProfile, setApplicantProfile] = useState<any>(null);
  const [history, setHistory] = useState<CaseHistoryItem[]>([]);
  const [tasks, setTasks] = useState<CaseTaskItem[]>([]);
  const [notes, setNotes] = useState<CaseNoteItem[]>([]);
  const [availableTransitions, setAvailableTransitions] = useState<InternalCaseStatus[]>([]);
  const [staffMembers, setStaffMembers] = useState<OrganizationMember[]>([]);

  // Form states
  const [selectedTransition, setSelectedTransition] = useState<string>('');
  const [transitionReason, setTransitionReason] = useState('');
  const [selectedConsultant, setSelectedConsultant] = useState('');
  const [govStatus, setGovStatus] = useState('');
  const [govSource, setGovSource] = useState('CONSULTANT_MANUAL_UPDATE');
  const [govRef, setGovRef] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<'APPLICANT_VISIBLE' | 'INTERNAL'>('APPLICANT_VISIBLE');
  const [submitting, setSubmitting] = useState(false);

  const isStaff = currentUser.role !== 'APPLICANT' || currentUser.isPlatformAdmin;
  const isAdmin = currentUser.role === 'AGENCY_ADMIN' || currentUser.isPlatformAdmin;

  async function loadDetail() {
    setLoading(true);
    setError(null);
    try {
      const detail = await apiRequest<{
        application: VisaCase & { official_source_url?: string };
        applicantProfile: any;
        history: CaseHistoryItem[];
        tasks: CaseTaskItem[];
        notes: CaseNoteItem[];
        availableTransitions: InternalCaseStatus[];
      }>(`/api/cases/${caseId}`);
      setApplication(detail.application);
      setApplicantProfile(detail.applicantProfile);
      setHistory(detail.history);
      setTasks(detail.tasks);
      setNotes(detail.notes);
      setAvailableTransitions(detail.availableTransitions);
      setSelectedTransition(detail.availableTransitions[0] || '');
      setSelectedConsultant(detail.application.assigned_consultant_id || '');
      setGovStatus(detail.application.government_status);
      setGovSource(
        detail.application.government_status_source === 'UNAVAILABLE'
          ? 'CONSULTANT_MANUAL_UPDATE'
          : detail.application.government_status_source,
      );
      setGovRef(detail.application.government_tracking_ref || '');

      if (isAdmin) {
        const membersRes = await apiRequest<{ members: OrganizationMember[] }>('/api/organizations/members');
        setStaffMembers(
          membersRes.members.filter((m) =>
            ['CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'].includes(m.role),
          ),
        );
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load case');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setActiveTab(initialTab);
  }, [caseId, initialTab]);

  useEffect(() => {
    loadDetail();
  }, [caseId]);

  async function handleTransition(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTransition) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/cases/${caseId}/transition`, {
        method: 'PATCH',
        body: { toStatus: selectedTransition, reason: transitionReason },
      });
      setTransitionReason('');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Workflow transition failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignConsultant(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/cases/${caseId}/assign`, {
        method: 'PATCH',
        body: { consultantUserId: selectedConsultant || null },
      });
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to update case assignment');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveGovStatus(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/cases/${caseId}/government-status`, {
        method: 'PATCH',
        body: {
          governmentStatus: govStatus,
          governmentStatusSource: govSource,
          governmentTrackingRef: govRef,
        },
      });
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to update external tracking status');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/cases/${caseId}/tasks`, {
        method: 'POST',
        body: { title: taskTitle, dueAt: taskDue || undefined },
      });
      setTaskTitle('');
      setTaskDue('');
      await loadDetail();
    } catch (err: any) {
      setError(err.message || 'Failed to add task');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleTask(task: CaseTaskItem) {
    const nextStatus = task.status === 'COMPLETED' ? 'OPEN' : 'COMPLETED';
    try {
      await apiRequest(`/api/cases/${caseId}/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      await loadDetail();
    } catch (err: any) {
      setError(err.message || 'Failed to update task');
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/cases/${caseId}/notes`, {
        method: 'POST',
        body: {
          body: noteBody,
          visibility: isStaff ? noteVisibility : 'APPLICANT_VISIBLE',
        },
      });
      setNoteBody('');
      await loadDetail();
    } catch (err: any) {
      setError(err.message || 'Failed to post note');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500 dark:text-slate-400">
        Loading case details and workflow history...
      </div>
    );
  }

  if (!application) {
    return (
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
        <p className="text-sm text-red-700 dark:text-red-400">{error || 'Case not found.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
        >
          Return to Cases
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Visa Cases
          </button>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-2xl font-bold font-mono tabular-nums">
              {application.reference_number}
            </h1>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {application.route_title}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Applicant: {application.applicant_name} ({application.applicant_email}) · Nationality:{' '}
            {application.nationality} · Origin: {application.origin_country} · Rule Version:{' '}
            <span className="font-mono">{application.rule_version}</span>
          </p>
        </div>

        <div className="text-right space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Internal Workflow Status</div>
          <div className={`text-sm font-semibold ${statusSemanticTone(application.internal_status)}`}>
            {STATUS_LABELS[application.internal_status] || application.internal_status}
          </div>
        </div>
      </div>

      {application.is_demo_rule === 1 && (
        <div className="p-3.5 rounded-lg border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Demonstration Rule Active ({application.rule_version}):</strong> This route uses sample demonstration rules for platform workflow verification and does not constitute live government policy or legal advice.
          </div>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Case Section Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-6 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'overview'
              ? 'border-blue-700 dark:border-blue-400 text-slate-900 dark:text-white'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Case Overview & Workflow
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('documents')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'documents'
              ? 'border-blue-700 dark:border-blue-400 text-slate-900 dark:text-white'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Documents & AI Verification
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('forms')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'forms'
              ? 'border-blue-700 dark:border-blue-400 text-slate-900 dark:text-white'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Dynamic Form & Submission
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tracking')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'tracking'
              ? 'border-blue-700 dark:border-blue-400 text-slate-900 dark:text-white'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Tracking, Appointments & Notifications
        </button>
      </div>

      {activeTab === 'documents' ? (
        <CaseDocumentsPanel
          caseId={caseId}
          currentUser={currentUser}
          onUpdated={onUpdated}
        />
      ) : activeTab === 'forms' ? (
        <CaseFormPanel
          caseId={caseId}
          currentUser={currentUser}
          applicantUserId={application.applicant_user_id}
          onUpdated={loadDetail}
        />
      ) : activeTab === 'tracking' ? (
        <CaseTrackingPanel
          caseId={caseId}
          currentUser={currentUser}
          onUpdated={loadDetail}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Main Column */}
        <div className="lg:col-span-8 space-y-6">
          {/* Separated Internal vs Official Status */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-1">
              <div className="text-xs text-slate-500 dark:text-slate-400">Internal Workflow Stage</div>
              <div className={`text-base font-semibold ${statusSemanticTone(application.internal_status)}`}>
                {STATUS_LABELS[application.internal_status]}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Consultant: {application.consultant_name || 'Unassigned'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Stage SLA Due: {formatShortDate(application.stage_due_at)} · Target Sub:{' '}
                {formatShortDate(application.target_submission_deadline)}
              </div>
            </div>
            <div className="space-y-1 sm:border-l sm:border-slate-200 dark:sm:border-slate-800 sm:pl-6">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Official / External Tracking Status
              </div>
              <div className="text-base font-semibold text-slate-900 dark:text-white">
                {application.government_status === 'NOT_SUBMITTED'
                  ? 'Status unavailable (Not submitted)'
                  : application.government_status}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                Source: {application.government_status_source}
                {application.government_tracking_ref ? ` · Ref: ${application.government_tracking_ref}` : ''}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Last verified:{' '}
                {application.government_status_verified_at
                  ? formatShortDate(application.government_status_verified_at)
                  : 'Never verified externally'}
              </div>
            </div>
          </div>

          {/* Workflow Transition & Staff Controls */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
            <h2 className="font-display text-base font-semibold">Workflow Controls</h2>

            {availableTransitions.length > 0 ? (
              <form onSubmit={handleTransition} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-4 space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Next Valid Stage
                  </label>
                  <select
                    value={selectedTransition}
                    onChange={(e) => setSelectedTransition(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {availableTransitions.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABELS[st] || st}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-5 space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Transition Note (Audited)
                  </label>
                  <input
                    type="text"
                    value={transitionReason}
                    onChange={(e) => setTransitionReason(e.target.value)}
                    placeholder="Reason for stage change"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2 px-3 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    Advance Stage
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No further transitions available for your role in the current stage.
              </p>
            )}

            {isAdmin && (
              <form
                onSubmit={handleAssignConsultant}
                className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-end gap-3"
              >
                <div className="flex-1 min-w-[200px] space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Assign Case Officer / Consultant (Same Tenant Only)
                  </label>
                  <select
                    value={selectedConsultant}
                    onChange={(e) => setSelectedConsultant(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="">Unassigned (Admin queue)</option>
                    {staffMembers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name} ({m.role})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Save Assignment
                </button>
              </form>
            )}

            {isStaff && (
              <form
                onSubmit={handleSaveGovStatus}
                className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
              >
                <div className="sm:col-span-4 space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    External Status Text
                  </label>
                  <input
                    type="text"
                    value={govStatus}
                    onChange={(e) => setGovStatus(e.target.value)}
                    placeholder="e.g., Biometrics Appointment Booked"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-3 space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Verified Source
                  </label>
                  <select
                    value={govSource}
                    onChange={(e) => setGovSource(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="CONSULTANT_MANUAL_UPDATE">Consultant Manual Update</option>
                    <option value="APPLICANT_UPLOADED_NOTICE">Applicant Uploaded Notice</option>
                    <option value="AUTHORIZED_EMAIL_INGESTION">Authorized Email Ingestion</option>
                    <option value="PARTNER_INTEGRATION">Partner Integration</option>
                  </select>
                </div>
                <div className="sm:col-span-3 space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Tracking Reference
                  </label>
                  <input
                    type="text"
                    value={govRef}
                    onChange={(e) => setGovRef(e.target.value)}
                    placeholder="Optional portal ref"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2 px-3 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
                  >
                    Save Status
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Tasks */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="font-display text-base font-semibold">Case Tasks & Deadlines</h2>
            {isStaff && (
              <form onSubmit={handleCreateTask} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Add an applicant or officer task..."
                  className="flex-1 min-w-[200px] px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <input
                  type="date"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                  className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Task
                </button>
              </form>
            )}
            {tasks.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No tasks assigned to this case yet.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {tasks.map((task) => (
                  <div key={task.id} className="py-2.5 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleToggleTask(task)}
                      className="flex items-center gap-2.5 text-left cursor-pointer"
                    >
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 ${
                          task.status === 'COMPLETED'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-300 dark:text-slate-600'
                        }`}
                      />
                      <span
                        className={`text-xs ${
                          task.status === 'COMPLETED'
                            ? 'line-through text-slate-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {task.title}
                      </span>
                    </button>
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                      {task.due_at ? formatShortDate(task.due_at) : task.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Case Notes */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="font-display text-base font-semibold">Case Communication & Notes</h2>
            <form onSubmit={handleAddNote} className="space-y-2.5">
              <textarea
                rows={2}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Write a case update or internal officer note..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <div className="flex items-center justify-between gap-3">
                {isStaff ? (
                  <select
                    value={noteVisibility}
                    onChange={(e) =>
                      setNoteVisibility(e.target.value as 'APPLICANT_VISIBLE' | 'INTERNAL')
                    }
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="APPLICANT_VISIBLE">Visible to Applicant</option>
                    <option value="INTERNAL">Internal Staff Only</option>
                  </select>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Visible to your assigned consultant
                  </span>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Post Note
                </button>
              </div>
            </form>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {notes.map((n) => (
                <div key={n.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {n.author_name} · {n.visibility === 'INTERNAL' ? 'Internal Note' : 'Applicant Visible'}
                    </span>
                    <span className="font-mono tabular-nums">{formatShortDate(n.created_at)}</span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Timeline & Applicant Snapshot */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="font-display text-sm font-semibold">Applicant Snapshot</h2>
            {applicantProfile ? (
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Legal Name</dt>
                  <dd className="font-medium text-right">{applicantProfile.full_legal_name}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Date of Birth</dt>
                  <dd className="font-mono tabular-nums">{applicantProfile.date_of_birth}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Passport (Masked)</dt>
                  <dd className="font-mono tabular-nums">
                    {applicantProfile.passport_number_masked || 'Not provided'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Passport Expiry</dt>
                  <dd className="font-mono tabular-nums">
                    {applicantProfile.expiry_date || '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Onboarding</dt>
                  <dd className="font-medium">
                    {applicantProfile.onboarding_completed ? 'Completed' : 'Pending'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Applicant has not completed onboarding profile yet.
              </p>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <h2 className="font-display text-sm font-semibold">Workflow History</h2>
            </div>
            <div className="space-y-3">
              {history.map((h) => (
                <div key={h.id} className="text-xs border-b border-slate-100 dark:border-slate-800 pb-2.5 last:border-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {STATUS_LABELS[h.to_status as InternalCaseStatus] || h.to_status}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">
                    {h.changed_by_name} · <span className="font-mono tabular-nums">{formatShortDate(h.created_at)}</span>
                  </div>
                  {h.reason && (
                    <div className="text-slate-600 dark:text-slate-300 mt-0.5">{h.reason}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
