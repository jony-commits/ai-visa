import React, { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  Mail,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  CaseAppointmentItem,
  NotificationJobItem,
  StatusTrackingOverview,
  statusSemanticTone,
  TimelineEventItem,
} from '../types';

interface CaseTrackingPanelProps {
  caseId: string;
  currentUser: AuthUser;
  onUpdated: () => void;
}

function formatDateTimeUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export const CaseTrackingPanel: React.FC<CaseTrackingPanelProps> = ({
  caseId,
  currentUser,
  onUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [overview, setOverview] = useState<StatusTrackingOverview | null>(null);
  const [appointments, setAppointments] = useState<CaseAppointmentItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEventItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationJobItem[]>([]);

  // Deadlines state
  const [targetDeadline, setTargetDeadline] = useState('');
  const [stageDueAt, setStageDueAt] = useState('');
  const [sendDeadlineReminder, setSendDeadlineReminder] = useState(true);

  // Manual external status state
  const [statusText, setStatusText] = useState('');
  const [sourceType, setSourceType] = useState('CONSULTANT_MANUAL_UPDATE');
  const [trackingRef, setTrackingRef] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');

  // Appointment create state
  const [apptType, setApptType] = useState<CaseAppointmentItem['appointment_type']>('BIOMETRICS');
  const [centerName, setCenterName] = useState('');
  const [centerAddress, setCenterAddress] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [bookingReference, setBookingReference] = useState('');
  const [instructions, setInstructions] = useState('');

  const [busy, setBusy] = useState(false);

  const isStaff = currentUser.role !== 'APPLICANT' || currentUser.isPlatformAdmin;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trackRes, apptRes, tlRes, ntfRes] = await Promise.all([
        apiRequest<StatusTrackingOverview>(`/api/cases/${caseId}/status-tracking`),
        apiRequest<{ appointments: CaseAppointmentItem[] }>(`/api/cases/${caseId}/appointments`),
        apiRequest<{ timeline: TimelineEventItem[] }>(`/api/cases/${caseId}/timeline`),
        apiRequest<{ jobs: NotificationJobItem[] }>(`/api/cases/${caseId}/notifications`),
      ]);
      setOverview(trackRes);
      setAppointments(apptRes.appointments);
      setTimeline(tlRes.timeline);
      setNotifications(ntfRes.jobs);

      setTargetDeadline(
        trackRes.targetSubmissionDeadline
          ? trackRes.targetSubmissionDeadline.slice(0, 16)
          : '',
      );
      setStageDueAt(trackRes.stageDueAt ? trackRes.stageDueAt.slice(0, 16) : '');
      setTrackingRef(trackRes.governmentTrackingRef || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load case tracking data');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleSaveDeadlines(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      await apiRequest(`/api/cases/${caseId}/deadlines`, {
        method: 'PATCH',
        body: {
          targetSubmissionDeadline: targetDeadline ? new Date(targetDeadline).toISOString() : null,
          stageDueAt: stageDueAt ? new Date(stageDueAt).toISOString() : null,
          scheduleReminder: sendDeadlineReminder,
        },
      });
      setBanner('Deadlines updated and reminders scheduled where applicable.');
      await loadAll();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to save deadlines');
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncOfficialApi() {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await apiRequest<{ synced: boolean; statusText?: string; reason?: string }>(
        `/api/cases/${caseId}/status-sync`,
        { method: 'POST' },
      );
      if (res.synced) {
        setBanner(`Synced official status: ${res.statusText}`);
      } else {
        setBanner(res.reason || 'Authorized official API unavailable.');
      }
      await loadAll();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Authorized API sync returned unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordManualStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!statusText.trim()) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      await apiRequest(`/api/cases/${caseId}/status-events`, {
        method: 'POST',
        body: {
          statusText: statusText.trim(),
          sourceType,
          trackingReference: trackingRef.trim() || undefined,
          rawEvidenceNote: evidenceNote.trim() || undefined,
        },
      });
      setStatusText('');
      setEvidenceNote('');
      setBanner('Verified source-attributed external status recorded.');
      await loadAll();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to record verified status event');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAppointment(e: React.FormEvent) {
    e.preventDefault();
    if (!centerName.trim() || !scheduledAt.trim()) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      await apiRequest(`/api/cases/${caseId}/appointments`, {
        method: 'POST',
        body: {
          appointmentType: apptType,
          centerName: centerName.trim(),
          centerAddress: centerAddress.trim() || undefined,
          scheduledAt: new Date(scheduledAt).toISOString(),
          timezone: timezone.trim() || 'UTC',
          bookingReference: bookingReference.trim() || undefined,
          instructions: instructions.trim() || undefined,
        },
      });
      setCenterName('');
      setCenterAddress('');
      setScheduledAt('');
      setBookingReference('');
      setInstructions('');
      setBanner('Appointment scheduled and applicant notifications queued.');
      await loadAll();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to schedule appointment');
    } finally {
      setBusy(false);
    }
  }

  async function handleAppointmentStatusChange(
    apptId: string,
    status: CaseAppointmentItem['status'],
  ) {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/cases/${caseId}/appointments/${apptId}`, {
        method: 'PATCH',
        body: { status },
      });
      await loadAll();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to update appointment');
    } finally {
      setBusy(false);
    }
  }

  async function handleRunNotificationWorker() {
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
        `Notification worker ran: ${res.delivered} delivered, ${res.retried} retry wait, ${res.failedPermanent} failed permanent.`,
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Failed to run notification worker');
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryNotification(jobId: string, resetAttempts = false) {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/notifications/${jobId}/retry`, {
        method: 'POST',
        body: { resetAttempts },
      });
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Retry failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500">
        Loading status tracking, appointments, and notifications...
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      {/* Official Status vs Adapter Contracts */}
      {overview && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                <h2 className="font-display text-base font-semibold">
                  Source-Attributed Government / External Status
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                External government status is isolated from internal agency workflow stages and never fabricated without verified adapter output or explicit human attribution.
              </p>
            </div>
            {isStaff && (
              <button
                type="button"
                disabled={busy}
                onClick={handleSyncOfficialApi}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Sync Authorized Official API
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/70 dark:bg-slate-950/50 text-xs">
            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400">Verified External Status</div>
              <div className="font-semibold text-sm text-slate-900 dark:text-white">
                {overview.governmentStatus === 'NOT_SUBMITTED'
                  ? 'Not Submitted / Unavailable'
                  : overview.governmentStatus}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400">Source Attribution</div>
              <div className="font-mono font-medium">{overview.governmentStatusSource}</div>
              <div className="font-mono text-slate-500 dark:text-slate-400">
                Ref: {overview.governmentTrackingRef || 'None'}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400">Last Verified Timestamp</div>
              <div className="font-mono tabular-nums font-medium">
                {overview.governmentStatusVerifiedAt
                  ? formatDateTimeUtc(overview.governmentStatusVerifiedAt)
                  : 'Never verified externally'}
              </div>
            </div>
          </div>

          {/* Adapter Contracts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {overview.adapterContracts.map((c) => (
              <div
                key={c.adapterId}
                className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.displayName}</span>
                  <span
                    className={`font-mono font-medium ${
                      c.connected
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {c.connected ? 'CONNECTED' : 'UNCONFIGURED'}
                  </span>
                </div>
                <p className="text-slate-500 dark:text-slate-400">{c.reason}</p>
              </div>
            ))}
          </div>

          {isStaff && (
            <form
              onSubmit={handleRecordManualStatus}
              className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
            >
              <div className="sm:col-span-4 space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Verified External Status
                </label>
                <input
                  type="text"
                  required
                  value={statusText}
                  onChange={(e) => setStatusText(e.target.value)}
                  placeholder="e.g. Received at Berlin Ausländerbehörde"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-3 space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Source Attribution
                </label>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="CONSULTANT_MANUAL_UPDATE">Consultant Manual Update</option>
                  <option value="APPLICANT_UPLOADED_NOTICE">Applicant Uploaded Notice</option>
                  <option value="AUTHORIZED_EMAIL_INGESTION">Authorized Email Ingestion</option>
                  <option value="PARTNER_INTEGRATION">Partner Integration</option>
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Tracking Ref
                </label>
                <input
                  type="text"
                  value={trackingRef}
                  onChange={(e) => setTrackingRef(e.target.value)}
                  placeholder="Optional ref"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-3 space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Evidence Note
                </label>
                <input
                  type="text"
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                  placeholder="Receipt / notice details"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-12 flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  Record Verified Status Event
                </button>
              </div>
            </form>
          )}

          {overview.events.length > 0 && (
            <div className="pt-2 space-y-2">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Verified External Status Log ({overview.events.length})
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs border border-slate-200 dark:border-slate-800 rounded-lg">
                {overview.events.map((ev) => (
                  <div key={ev.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {ev.status_text}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        Source: <span className="font-mono">{ev.source_type}</span>
                        {ev.tracking_reference ? ` · Ref: ${ev.tracking_reference}` : ''}
                        {ev.raw_evidence_note ? ` · ${ev.raw_evidence_note}` : ''}
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      <div>Verified: {formatDateTimeUtc(ev.verified_at)}</div>
                      <div>{ev.verified_by_name || 'Authorized API'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deadlines & Appointments Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Deadlines */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            <h2 className="font-display text-base font-semibold">Deadlines & Stage SLA</h2>
          </div>

          <dl className="space-y-2 text-xs border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Target Submission Deadline</dt>
              <dd className="font-mono tabular-nums font-medium">
                {overview?.targetSubmissionDeadline
                  ? formatDateTimeUtc(overview.targetSubmissionDeadline)
                  : 'Unset'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Current Stage SLA Due</dt>
              <dd className="font-mono tabular-nums font-medium">
                {overview?.stageDueAt ? formatDateTimeUtc(overview.stageDueAt) : 'Unset'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Next Active Appointment</dt>
              <dd className="font-mono tabular-nums font-medium">
                {overview?.appointmentAt ? formatDateTimeUtc(overview.appointmentAt) : 'None'}
              </dd>
            </div>
          </dl>

          {isStaff && (
            <form onSubmit={handleSaveDeadlines} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="block font-medium text-slate-600 dark:text-slate-400">
                  Target Submission Deadline (UTC)
                </label>
                <input
                  type="datetime-local"
                  value={targetDeadline}
                  onChange={(e) => setTargetDeadline(e.target.value)}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="space-y-1">
                <label className="block font-medium text-slate-600 dark:text-slate-400">
                  Current Stage SLA Due (UTC)
                </label>
                <input
                  type="datetime-local"
                  value={stageDueAt}
                  onChange={(e) => setStageDueAt(e.target.value)}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendDeadlineReminder}
                  onChange={(e) => setSendDeadlineReminder(e.target.checked)}
                />
                Queue deadline reminder notification (respects applicant consent)
              </label>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2 px-3 font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Update Deadlines
              </button>
            </form>
          )}
        </div>

        {/* Appointments */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <h2 className="font-display text-base font-semibold">Appointment Tracking</h2>
          </div>

          {appointments.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No biometrics, consulate interview, or medical appointments scheduled yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
              {appointments.map((apt) => (
                <div key={apt.id} className="p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">
                      {apt.appointment_type} · {apt.center_name}
                    </div>
                    <div className={`font-mono font-medium ${statusSemanticTone(apt.status)}`}>
                      {apt.status}
                    </div>
                  </div>
                  <div className="text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                    {formatDateTimeUtc(apt.scheduled_at)} ({apt.timezone})
                    {apt.booking_reference ? ` · Ref: ${apt.booking_reference}` : ''}
                  </div>
                  {apt.instructions && (
                    <p className="text-slate-500 dark:text-slate-400">{apt.instructions}</p>
                  )}
                  {isStaff && apt.status !== 'COMPLETED' && apt.status !== 'CANCELLED' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAppointmentStatusChange(apt.id, 'COMPLETED')}
                        className="px-2.5 py-1 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Mark Completed
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAppointmentStatusChange(apt.id, 'CANCELLED')}
                        className="px-2.5 py-1 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        Cancel & Notify
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {isStaff && (
            <form
              onSubmit={handleCreateAppointment}
              className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"
            >
              <div className="space-y-1">
                <label className="block font-medium text-slate-600 dark:text-slate-400">
                  Appointment Type
                </label>
                <select
                  value={apptType}
                  onChange={(e) =>
                    setApptType(e.target.value as CaseAppointmentItem['appointment_type'])
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="BIOMETRICS">Biometrics / VAC</option>
                  <option value="CONSULATE_INTERVIEW">Consulate Interview</option>
                  <option value="MEDICAL_EXAM">Panel Physician Medical</option>
                  <option value="PASSPORT_COLLECTION">Passport / Decision Collection</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="block font-medium text-slate-600 dark:text-slate-400">
                  Center / Consulate Name
                </label>
                <input
                  type="text"
                  required
                  value={centerName}
                  onChange={(e) => setCenterName(e.target.value)}
                  placeholder="VFS Global / Consulate General"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="space-y-1">
                <label className="block font-medium text-slate-600 dark:text-slate-400">
                  Date & Time (UTC)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="space-y-1">
                <label className="block font-medium text-slate-600 dark:text-slate-400">
                  Booking Ref & Timezone
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={bookingReference}
                    onChange={(e) => setBookingReference(e.target.value)}
                    placeholder="Ref #"
                    className="w-1/2 px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="UTC"
                    className="w-1/2 px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  Schedule Appointment
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Unified Chronological Timeline & Notification Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="font-display text-base font-semibold">Unified Case Timeline</h2>
          {timeline.length === 0 ? (
            <p className="text-xs text-slate-500">No timeline events recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs max-h-[420px] overflow-y-auto pr-1">
              {timeline.map((item) => (
                <div key={item.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                      {item.category}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatDateTimeUtc(item.timestamp)}
                    </span>
                  </div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">{item.title}</div>
                  <div className="text-slate-600 dark:text-slate-400">{item.detail}</div>
                  {item.actor && (
                    <div className="text-[11px] text-slate-500">
                      Actor: {item.actor} · Source: {item.sourceAttribution || 'SYSTEM'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-slate-500" />
              <h2 className="font-display text-base font-semibold">
                Case Email & SMS Outbox
              </h2>
            </div>
            {isStaff && (
              <button
                type="button"
                disabled={busy}
                onClick={handleRunNotificationWorker}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Dispatch Queued Alerts
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No notifications scheduled yet for this case. Transitions, assignments, deadlines, and appointments automatically queue alerts.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs max-h-[420px] overflow-y-auto pr-1">
              {notifications.map((job) => (
                <div key={job.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold">
                      {job.channel} · {job.templateKey}
                    </span>
                    <span className={`font-mono font-medium ${statusSemanticTone(job.status)}`}>
                      {job.status} ({job.attempts}/{job.maxAttempts})
                    </span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-400">
                    To: <span className="font-mono">{job.recipientContact}</span>
                  </div>
                  <div className="text-slate-700 dark:text-slate-300 line-clamp-2">
                    {job.subject ? `${job.subject} — ` : ''}
                    {job.renderedBody}
                  </div>
                  {job.lastError && (
                    <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{job.lastError}</span>
                    </div>
                  )}
                  {isStaff && (job.status === 'RETRY_WAIT' || job.status === 'FAILED_PERMANENT') && (
                    <div className="pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          handleRetryNotification(job.id, job.status === 'FAILED_PERMANENT')
                        }
                        className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        {job.status === 'FAILED_PERMANENT' ? 'Reset & Retry Delivery' : 'Retry Now'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
