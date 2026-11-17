import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Cpu,
  FileCheck2,
  RefreshCw,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  AdminTenantSummary,
  AiUsageAnalyticsData,
  AnalyticsOverviewData,
  AuthUser,
  formatShortDate,
  InternalCaseStatus,
  ROLE_LABELS,
  STATUS_LABELS,
  statusSemanticTone,
  VisaCase,
  VisaRouteItem,
} from '../types';

export type DashboardNavTarget =
  | 'overview'
  | 'cases'
  | 'kanban'
  | 'verification'
  | 'workflows'
  | 'profile'
  | 'team'
  | 'security'
  | 'roadmap';

interface RoleDashboardViewProps {
  user: AuthUser;
  cases: VisaCase[];
  routes: VisaRouteItem[];
  onboardingCompleted: boolean | null;
  onSelectCase: (caseId: string, tab?: 'overview' | 'documents') => void;
  onNavigate: (section: DashboardNavTarget) => void;
}

const SLA_LABELS: Record<string, { text: string; tone: string }> = {
  OVERDUE: { text: 'SLA Overdue', tone: 'text-red-700 dark:text-red-400' },
  DUE_SOON: { text: 'Due <= 48h', tone: 'text-amber-700 dark:text-amber-400' },
  ON_TRACK: { text: 'On Track', tone: 'text-emerald-700 dark:text-emerald-400' },
  UNSET: { text: 'No SLA', tone: 'text-slate-500 dark:text-slate-400' },
};

export const RoleDashboardView: React.FC<RoleDashboardViewProps> = ({
  user,
  cases,
  routes,
  onboardingCompleted,
  onSelectCase,
  onNavigate,
}) => {
  const [scope, setScope] = useState<'platform' | 'tenant'>(
    user.isPlatformAdmin ? 'platform' : 'tenant',
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverviewData | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageAnalyticsData | null>(null);
  const [tenants, setTenants] = useState<AdminTenantSummary[]>([]);
  const [platformRuleSummary, setPlatformRuleSummary] = useState<{
    countries_count: number;
    categories_count: number;
    routes_count: number;
    form_schemas_count: number;
  } | null>(null);
  const [tenantActionBusy, setTenantActionBusy] = useState<string | null>(null);

  const isStaff = user.role !== 'APPLICANT' || user.isPlatformAdmin;
  const isAdminOrOfficer =
    user.role === 'AGENCY_ADMIN' || user.role === 'VERIFICATION_OFFICER' || user.isPlatformAdmin;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const effectiveScope = user.isPlatformAdmin ? scope : 'tenant';
      const overviewPromise = apiRequest<AnalyticsOverviewData>(
        `/api/analytics/overview?scope=${effectiveScope}`,
      );
      const aiPromise = isStaff
        ? apiRequest<AiUsageAnalyticsData>(`/api/analytics/ai-usage?scope=${effectiveScope}`)
        : Promise.resolve(null);
      const tenantsPromise = user.isPlatformAdmin
        ? apiRequest<{
            tenants: AdminTenantSummary[];
            ruleSummary?: {
              countries_count: number;
              categories_count: number;
              routes_count: number;
              form_schemas_count: number;
            };
          }>('/api/admin/tenants')
        : Promise.resolve(null);

      const [overviewRes, aiRes, tenantsRes] = await Promise.all([
        overviewPromise,
        aiPromise,
        tenantsPromise,
      ]);

      setOverview(overviewRes);
      setAiUsage(aiRes);
      if (tenantsRes) {
        setTenants(tenantsRes.tenants || []);
        setPlatformRuleSummary(tenantsRes.ruleSummary || null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load operational dashboard analytics.');
    } finally {
      setLoading(false);
    }
  }, [isStaff, scope, user.isPlatformAdmin]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleToggleTenantStatus(orgId: string, nextStatus: 'ACTIVE' | 'SUSPENDED') {
    setTenantActionBusy(orgId);
    setError(null);
    try {
      await apiRequest(`/api/admin/tenants/${orgId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      await loadDashboard();
    } catch (err: any) {
      setError(err.message || 'Failed to update tenant status.');
    } finally {
      setTenantActionBusy(null);
    }
  }

  const roleHeading = user.isPlatformAdmin
    ? 'Platform Super Admin Console'
    : user.role === 'AGENCY_ADMIN'
      ? 'Agency Operations Dashboard'
      : user.role === 'VERIFICATION_OFFICER'
        ? 'Verification & Compliance Workbench'
        : user.role === 'CONSULTANT'
          ? 'Consultant Case Operations'
          : 'Applicant Immigration Portal';

  const summary = overview?.summary;
  const maxStageCount = Math.max(
    1,
    ...(overview?.stageBreakdown.map((s) => s.count) || [1]),
  );

  return (
    <div className="space-y-7">
      {/* Header & Role Context Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{roleHeading}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {user.isPlatformAdmin && scope === 'platform'
              ? `Global cross-tenant telemetry across ${tenants.length} organizations`
              : `Tenant-isolated operations for ${user.organizationName}`}{' '}
            · Role: {user.isPlatformAdmin ? 'Super Admin' : ROLE_LABELS[user.role]}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {user.isPlatformAdmin && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setScope('platform')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  scope === 'platform'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Platform Governance
              </button>
              <button
                type="button"
                onClick={() => setScope('tenant')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  scope === 'tenant'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Active Tenant ({user.organizationName})
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={loadDashboard}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Metrics
          </button>
        </div>
      </div>

      {/* Explicit Error Banner */}
      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 flex flex-wrap items-center justify-between gap-3 text-xs text-red-800 dark:text-red-300"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={loadDashboard}
            className="px-3 py-1.5 font-medium border border-red-400 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Applicant Onboarding & Consent Gate Banner */}
      {user.role === 'APPLICANT' && !user.isPlatformAdmin && onboardingCompleted === false && (
        <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="font-display text-sm font-semibold">
              Complete your applicant onboarding profile
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Add your legal details, encrypted passport record, travel destination, and data consent before submitting documents.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('profile')}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap cursor-pointer"
          >
            Start Onboarding
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !overview ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-28 bg-slate-200 dark:bg-slate-800/70 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : null}

      {/* Role-Specific 4-Column Operational KPI Strip */}
      {overview && summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {user.isPlatformAdmin && scope === 'platform' ? (
            <>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Provisioned Agencies</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {tenants.length}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {tenants.filter((t) => t.status === 'ACTIVE').length} active ·{' '}
                  {tenants.filter((t) => t.status === 'SUSPENDED').length} suspended
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Cross-Tenant Cases</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {summary.totalCases}
                </div>
                <div
                  className={`text-xs font-mono tabular-nums ${
                    summary.overdueSlaCount > 0
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {summary.overdueSlaCount} SLA overdue · {summary.unassignedCases} unassigned
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Platform AI Usage</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {aiUsage ? aiUsage.totals.totalTokens.toLocaleString() : '0'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {aiUsage?.totals.totalCalls || 0} calls · {aiUsage?.totals.failedCount || 0} failed
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Queues & Alerts Health</div>
                <div
                  className={`font-display text-2xl font-bold font-mono tabular-nums ${
                    overview.processingJobs.failed + overview.notificationDelivery.failedPermanent > 0
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {overview.processingJobs.failed + overview.notificationDelivery.failedPermanent} failures
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {overview.notificationDelivery.delivered} delivered · {overview.notificationDelivery.retryWait} retrying
                </div>
              </div>
            </>
          ) : user.role === 'APPLICANT' && !user.isPlatformAdmin ? (
            <>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">My Applications</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {summary.totalCases}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {summary.submittedOrDecided} submitted / decided
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Action Required</div>
                <div
                  className={`font-display text-2xl font-bold font-mono tabular-nums ${
                    summary.pendingApplicantAction > 0
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {summary.pendingApplicantAction}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {overview.applicantSummary?.missingMandatoryDocsCount || 0} missing mandatory docs
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Open Tasks & Forms</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {summary.openTasksCount}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {overview.applicantSummary?.unapprovedCompleteFormsCount || 0} forms awaiting your sign-off
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Upcoming Appointments</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {summary.upcomingAppointmentsCount}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Biometrics & consular schedule
                </div>
              </div>
            </>
          ) : user.role === 'CONSULTANT' && !user.isPlatformAdmin ? (
            <>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Assigned to Me</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {summary.assignedToMeCount}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {summary.unassignedCases} unassigned in agency
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">SLA Pressure</div>
                <div
                  className={`font-display text-2xl font-bold font-mono tabular-nums ${
                    summary.overdueSlaCount > 0
                      ? 'text-red-700 dark:text-red-400'
                      : summary.dueWithin48hCount > 0
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {summary.overdueSlaCount} overdue
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {summary.dueWithin48hCount} due within 48 hours
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Verification Backlog</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                  {summary.pendingDocumentsCount}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {summary.openVerificationIssuesCount} open consistency issues
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Ready / In Review</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {summary.inReviewOrReady}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {summary.upcomingAppointmentsCount} upcoming appointments
                </div>
              </div>
            </>
          ) : (
            /* Agency Admin / Verification Officer */
            <>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Agency Cases & Turnaround</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {summary.totalCases}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {summary.avgTurnaroundHours !== null
                    ? `Avg ${summary.avgTurnaroundHours}h turnaround`
                    : `${summary.activeCases} active · no decided cases yet`}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">SLA & Unassigned Load</div>
                <div
                  className={`font-display text-2xl font-bold font-mono tabular-nums ${
                    summary.overdueSlaCount > 0
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {summary.overdueSlaCount} overdue
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {summary.dueWithin48hCount} due &lt;= 48h · {summary.unassignedCases} unassigned
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Document Review Queue</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums">
                  {summary.pendingDocumentsCount}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {summary.openVerificationIssuesCount} open issues · {summary.quarantinedDocsCount} quarantined
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Notification Queue</div>
                <div className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {overview.notificationDelivery.delivered} sent
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {overview.notificationDelivery.retryWait} retry ·{' '}
                  {overview.notificationDelivery.failedPermanent} failed
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Applicant Onboarding & Consents Readiness Panel */}
      {overview?.applicantSummary && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">
                Onboarding & Consent Status
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Required identity details, encrypted passport record, and explicit consent flags.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Manage Profile & Consents
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Onboarding Profile</div>
              <div
                className={`font-semibold mt-1 ${
                  overview.applicantSummary.onboardingCompleted
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {overview.applicantSummary.onboardingCompleted ? 'Completed' : 'Action Required'}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Personal Data Processing</div>
              <div
                className={`font-semibold mt-1 ${
                  overview.applicantSummary.consentPersonal
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {overview.applicantSummary.consentPersonal ? 'Granted' : 'Not Granted'}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">External AI Processing</div>
              <div className="font-semibold mt-1 text-slate-800 dark:text-slate-200">
                {overview.applicantSummary.consentAi ? 'Opted In' : 'Disabled (Deterministic Only)'}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Case Notifications</div>
              <div className="font-semibold mt-1 text-slate-800 dark:text-slate-200">
                {overview.applicantSummary.consentComms ? 'Email/SMS Enabled' : 'Disabled'}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Super Admin Cross-Tenant Governance Table */}
      {user.isPlatformAdmin && scope === 'platform' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">
                Cross-Tenant Governance & Health
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Monitor per-agency SLA pressure, open verification issues, AI token usage, and tenant access status.
              </p>
            </div>
            {platformRuleSummary && (
              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {platformRuleSummary.countries_count} countries · {platformRuleSummary.routes_count} demo routes ·{' '}
                {platformRuleSummary.form_schemas_count} JSON schemas
              </div>
            )}
          </div>
          {tenants.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No agencies provisioned yet.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-medium">Organization</th>
                  <th className="py-3 px-4 font-medium">Plan</th>
                  <th className="py-3 px-4 font-medium text-right">Members</th>
                  <th className="py-3 px-4 font-medium text-right">Cases</th>
                  <th className="py-3 px-4 font-medium text-right">Overdue SLA</th>
                  <th className="py-3 px-4 font-medium text-right">Open Issues</th>
                  <th className="py-3 px-4 font-medium text-right">Failed Alerts</th>
                  <th className="py-3 px-4 font-medium text-right">AI Tokens</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4">
                      <div className="font-medium">{t.name}</div>
                      <div className="font-mono text-slate-500 dark:text-slate-400">
                        {t.slug} · {t.country_code}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono">{t.plan_tier}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{t.member_count}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{t.case_count}</td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums ${
                        t.overdue_cases_count > 0 ? 'text-red-700 dark:text-red-400 font-semibold' : ''
                      }`}
                    >
                      {t.overdue_cases_count}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums ${
                        t.open_issues_count > 0 ? 'text-amber-700 dark:text-amber-400 font-semibold' : ''
                      }`}
                    >
                      {t.open_issues_count}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums ${
                        t.failed_notifications_count > 0
                          ? 'text-red-700 dark:text-red-400 font-semibold'
                          : ''
                      }`}
                    >
                      {t.failed_notifications_count}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {t.ai_total_tokens.toLocaleString()} ({t.ai_call_count})
                    </td>
                    <td
                      className={`py-3 px-4 font-semibold ${
                        t.status === 'ACTIVE'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {t.status}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        disabled={tenantActionBusy === t.id}
                        onClick={() =>
                          handleToggleTenantStatus(t.id, t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')
                        }
                        className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                      >
                        {t.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* Priority Queue & Stage Bottleneck Grid */}
      {overview && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Priority Queue / Next Actions */}
          <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 className="font-display text-base font-semibold">
                  {user.role === 'APPLICANT' && !user.isPlatformAdmin
                    ? 'Your Next Required Actions'
                    : 'Operational Priority & SLA Queue'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('kanban')}
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Open Kanban
              </button>
            </div>
            {overview.priorityCases.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No urgent SLA breaches, unassigned cases, or pending actions right now.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {overview.priorityCases.map((item) => {
                  const slaMeta = SLA_LABELS[item.slaState] || SLA_LABELS.UNSET;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectCase(item.id, 'overview')}
                      className="w-full text-left px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 flex flex-wrap items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                            {item.referenceNumber}
                          </span>
                          <span className="font-medium truncate">{item.applicantName}</span>
                          <span className="text-slate-500 dark:text-slate-400 font-mono">
                            {item.destinationCountry} · {item.visaCategory}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-300">
                          {item.actionReason} ·{' '}
                          <span className={statusSemanticTone(item.internalStatus)}>
                            {STATUS_LABELS[item.internalStatus as InternalCaseStatus] || item.internalStatus}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <div className={`text-xs font-semibold ${slaMeta.tone}`}>{slaMeta.text}</div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          Due: {formatShortDate(item.stageDueAt)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Workflow Stage Bottleneck Distribution */}
          <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold">
                Workflow Stage Bottlenecks
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {overview.summary.totalCases} total
              </span>
            </div>
            {overview.stageBreakdown.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create or assign cases to populate stage distribution metrics.
              </p>
            ) : (
              <div className="space-y-3">
                {overview.stageBreakdown.map((st) => {
                  const pct = Math.max(6, Math.round((st.count / maxStageCount) * 100));
                  return (
                    <div key={st.stageCode} className="space-y-1">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="font-medium truncate">
                          {STATUS_LABELS[st.stageCode as InternalCaseStatus] || st.stageCode}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">
                          {st.count} case{st.count === 1 ? '' : 's'}
                          {st.overdueCount > 0 ? ` · ${st.overdueCount} overdue` : ''} · avg{' '}
                          {st.avgAgeHours}h
                        </span>
                      </div>
                      <div className="h-2 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded ${
                            st.overdueCount > 0 ? 'bg-amber-600 dark:bg-amber-500' : 'bg-blue-700 dark:bg-blue-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Consultant Workload & Upcoming Appointments Row */}
      {overview && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {isStaff && overview.consultantWorkload.length > 0 && (
            <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-500" />
                  <h2 className="font-display text-base font-semibold">
                    Staff Workload & SLA Capacity
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('team')}
                  className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Manage Team
                </button>
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-medium">Staff Member</th>
                    <th className="py-2.5 px-4 font-medium">Role</th>
                    <th className="py-2.5 px-4 font-medium text-right">Active</th>
                    <th className="py-2.5 px-4 font-medium text-right">Due &lt;= 48h</th>
                    <th className="py-2.5 px-4 font-medium text-right">Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {overview.consultantWorkload.map((member) => (
                    <tr key={member.userId}>
                      <td className="py-2.5 px-4 font-medium">{member.fullName}</td>
                      <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                        {ROLE_LABELS[member.role] || member.role}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {member.activeCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                        {member.dueSoonCount}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                          member.overdueCount > 0 ? 'text-red-700 dark:text-red-400 font-semibold' : ''
                        }`}
                      >
                        {member.overdueCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Upcoming Appointments */}
          <section
            className={`${
              isStaff && overview.consultantWorkload.length > 0 ? 'lg:col-span-6' : 'lg:col-span-12'
            } bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                <h2 className="font-display text-base font-semibold">
                  Upcoming Biometric & Consular Appointments
                </h2>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {overview.upcomingAppointments.length} scheduled
              </span>
            </div>
            {overview.upcomingAppointments.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                No upcoming appointments scheduled. Open any case&apos;s Tracking tab to schedule one.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {overview.upcomingAppointments.map((apt) => (
                  <div
                    key={apt.id}
                    className="py-2.5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5">
                      <div className="font-medium">
                        {apt.appointment_type} · {apt.center_name}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{apt.reference_number}</span> ({apt.applicant_name})
                        {apt.booking_reference ? ` · Ref: ${apt.booking_reference}` : ''}
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <div className="font-medium">{formatShortDate(apt.scheduled_at)}</div>
                      <div className={statusSemanticTone(apt.status)}>{apt.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* AI Usage & Extraction Telemetry (Staff & Super Admin) */}
      {isStaff && aiUsage && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <div>
                <h2 className="font-display text-base font-semibold">
                  AI Usage, Token Telemetry & OCR Engines
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tracks server-side @google/genai calls, token consumption, failures, and deterministic extraction fallback.
                </p>
              </div>
            </div>
            <div className="text-xs font-mono">
              Gemini Live Key:{' '}
              <span
                className={
                  aiUsage.geminiConfigured
                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                    : 'text-amber-700 dark:text-amber-400 font-semibold'
                }
              >
                {aiUsage.geminiConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED (Deterministic Fallback)'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Live AI API Calls</div>
              <div className="font-mono tabular-nums text-lg font-bold mt-0.5">
                {aiUsage.totals.totalCalls}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Success / Failed</div>
              <div className="font-mono tabular-nums text-lg font-bold mt-0.5">
                {aiUsage.totals.successCount} /{' '}
                <span className={aiUsage.totals.failedCount > 0 ? 'text-red-700 dark:text-red-400' : ''}>
                  {aiUsage.totals.failedCount}
                </span>
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Input Tokens</div>
              <div className="font-mono tabular-nums text-lg font-bold mt-0.5">
                {aiUsage.totals.totalInputTokens.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Output Tokens</div>
              <div className="font-mono tabular-nums text-lg font-bold mt-0.5">
                {aiUsage.totals.totalOutputTokens.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Extraction Provider Breakdown + Recent AI Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Document Extraction Engine Breakdown
              </div>
              {aiUsage.extractionBreakdown.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No document extractions processed in this scope yet.
                </p>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Provider / Model</th>
                      <th className="py-2 pr-3 font-medium text-right">Docs</th>
                      <th className="py-2 pr-3 font-medium text-right">Confirmed</th>
                      <th className="py-2 font-medium text-right">Avg Conf.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {aiUsage.extractionBreakdown.map((row, idx) => (
                      <tr key={idx}>
                        <td className="py-2 pr-3 font-mono">
                          {row.ai_provider} · {row.model_name}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {row.document_count}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {row.confirmed_count}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {row.avg_confidence !== null ? `${Math.round(row.avg_confidence * 100)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Recent Gemini Usage Logs
              </div>
              {aiUsage.recentLogs.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {aiUsage.geminiConfigured
                    ? 'No Gemini extraction or form suggestion calls recorded yet.'
                    : 'No live Gemini API calls recorded (using deterministic parser fallback until GEMINI_API_KEY is configured).'}
                </p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs max-h-44 overflow-y-auto">
                  {aiUsage.recentLogs.slice(0, 8).map((log) => (
                    <div key={log.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono truncate">
                          {log.model} · {log.prompt_version}
                          {log.reference_number ? ` · ${log.reference_number}` : ''}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 truncate">
                          {log.actor_email || 'System'} · {formatShortDate(log.created_at)}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <span className={statusSemanticTone(log.status)}>{log.status}</span> ·{' '}
                        {log.input_tokens + log.output_tokens} tok
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Quick Operational Links + Recent Cases Table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold">
            {user.role === 'APPLICANT' && !user.isPlatformAdmin
              ? 'My Visa Applications (Internal vs. Official Verified Status)'
              : 'Recent Visa Applications'}
          </h2>
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
            {isStaff && (
              <button
                type="button"
                onClick={() => onNavigate('verification')}
                className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:underline cursor-pointer"
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                Verification Queue
              </button>
            )}
            {isAdminOrOfficer && (
              <button
                type="button"
                onClick={() => onNavigate('security')}
                className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:underline cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                Audit History
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('cases')}
              className="text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
            >
              View all cases
            </button>
          </div>
        </div>
        {cases.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No applications created in this workspace yet.
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-5 font-medium">Reference</th>
                <th className="py-3 px-5 font-medium">Applicant</th>
                <th className="py-3 px-5 font-medium">Route</th>
                <th className="py-3 px-5 font-medium">Internal Status</th>
                <th className="py-3 px-5 font-medium">Official Status</th>
                <th className="py-3 px-5 font-medium">Last Verified</th>
                <th className="py-3 px-5 font-medium text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {cases.slice(0, 8).map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onSelectCase(c.id, 'overview')}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                >
                  <td className="py-3 px-5 font-mono tabular-nums font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap">
                    {c.reference_number}
                  </td>
                  <td className="py-3 px-5 font-medium">{c.applicant_name}</td>
                  <td className="py-3 px-5 text-slate-600 dark:text-slate-400">
                    {c.destination_country_name || c.destination_country} · {c.visa_category}
                  </td>
                  <td className={`py-3 px-5 font-medium ${statusSemanticTone(c.internal_status)}`}>
                    {STATUS_LABELS[c.internal_status]}
                  </td>
                  <td className="py-3 px-5 text-slate-600 dark:text-slate-300 font-mono">
                    {c.government_status === 'NOT_SUBMITTED'
                      ? 'Not submitted (UNAVAILABLE)'
                      : `${c.government_status} (${c.government_status_source})`}
                  </td>
                  <td className="py-3 px-5 font-mono tabular-nums text-slate-500">
                    {formatShortDate(c.government_status_verified_at)}
                  </td>
                  <td className="py-3 px-5 text-right font-mono tabular-nums text-slate-500">
                    {formatShortDate(c.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Configured Demonstration Routes */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold">
            Configured Visa Routes (Demonstration Rules)
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Do not treat sample data as live government policy
          </span>
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
          {routes.map((r) => (
            <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-medium">{r.title}</div>
                <div className="text-slate-500 dark:text-slate-400">{r.summary}</div>
              </div>
              <div className="font-mono text-slate-500 dark:text-slate-400 shrink-0">
                {r.destination_country} · {r.rule_version}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
