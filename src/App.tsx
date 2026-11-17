import React, { useCallback, useEffect, useState } from 'react';
import {
  Briefcase,
  FileCheck2,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Moon,
  Plus,
  Shield,
  Sun,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { ApplicantProfileView } from './components/ApplicantProfileView';
import { AuthPortal } from './components/AuthPortal';
import { CaseDetailPanel } from './components/CaseDetailPanel';
import { CasesView } from './components/CasesView';
import { RoadmapView } from './components/RoadmapView';
import { SecurityAuditView } from './components/SecurityAuditView';
import { TeamAdminView } from './components/TeamAdminView';
import { VerificationQueueView } from './components/VerificationQueueView';
import { WorkflowTemplatesView } from './components/WorkflowTemplatesView';
import { apiRequest, setStoredToken } from './lib/api';
import {
  AuthUser,
  formatShortDate,
  ROLE_LABELS,
  STATUS_LABELS,
  statusSemanticTone,
  VisaCase,
  VisaCategoryItem,
  VisaCountryItem,
  VisaRouteItem,
} from './types';

type NavSection =
  | 'overview'
  | 'cases'
  | 'kanban'
  | 'verification'
  | 'workflows'
  | 'profile'
  | 'team'
  | 'security'
  | 'roadmap';

const NAV_TITLES: Record<NavSection, string> = {
  overview: 'Overview',
  cases: 'Visa Cases',
  kanban: 'Case Kanban Board',
  verification: 'Document Verification',
  workflows: 'Workflows & Notifications',
  profile: 'Applicant Onboarding & Profile',
  team: 'Organization & Team Access',
  security: 'Security & Audit Trail',
  roadmap: 'Platform Roadmap',
};

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('meridian_theme') === 'dark';
    } catch {
      return false;
    }
  });

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [section, setSection] = useState<NavSection>('overview');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCaseTab, setSelectedCaseTab] = useState<'overview' | 'documents'>('overview');
  const [openNewCaseModal, setOpenNewCaseModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [cases, setCases] = useState<VisaCase[]>([]);
  const [countries, setCountries] = useState<VisaCountryItem[]>([]);
  const [categories, setCategories] = useState<VisaCategoryItem[]>([]);
  const [routes, setRoutes] = useState<VisaRouteItem[]>([]);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem('meridian_theme', darkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage error
    }
  }, [darkMode]);

  const loadWorkspaceData = useCallback(async () => {
    const [casesRes, catalogRes, profileRes] = await Promise.all([
      apiRequest<{ cases: VisaCase[] }>('/api/cases'),
      apiRequest<{
        countries: VisaCountryItem[];
        categories: VisaCategoryItem[];
        routes: VisaRouteItem[];
      }>('/api/catalog/routes'),
      apiRequest<{ profile: { onboardingCompleted: boolean } | null }>('/api/applicant/profile').catch(
        () => ({ profile: null }),
      ),
    ]);
    setCases(casesRes.cases);
    setCountries(catalogRes.countries);
    setCategories(catalogRes.categories);
    setRoutes(catalogRes.routes);
    setOnboardingCompleted(Boolean(profileRes.profile?.onboardingCompleted));
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const me = await apiRequest<{ user: AuthUser }>('/api/auth/me');
      setUser(me.user);
      await loadWorkspaceData();
    } catch {
      setUser(null);
      setStoredToken(null);
    } finally {
      setCheckingAuth(false);
    }
  }, [loadWorkspaceData]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout failure
    }
    setStoredToken(null);
    setUser(null);
    setSelectedCaseId(null);
    setSection('overview');
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Loading Meridian Visa workspace...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPortal
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        onAuthenticated={refreshSession}
      />
    );
  }

  const pendingActionCount = cases.filter((c) =>
    [
      'APPLICANT_INFO_PENDING',
      'DOCUMENT_COLLECTION',
      'ADDITIONAL_INFO_REQUESTED',
      'RETURNED_FOR_CORRECTION',
      'APPLICANT_APPROVAL',
    ].includes(c.internal_status),
  ).length;

  const reviewQueueCount = cases.filter((c) =>
    ['DOCUMENT_VERIFICATION', 'CONSULTANT_REVIEW', 'READY_FOR_SUBMISSION'].includes(
      c.internal_status,
    ),
  ).length;

  const submittedCount = cases.filter((c) =>
    ['SUBMITTED', 'AWAITING_APPOINTMENT_DECISION', 'DECISION_RECEIVED', 'APPROVED'].includes(
      c.internal_status,
    ),
  ).length;

  const isStaff = user.role !== 'APPLICANT' || user.isPlatformAdmin;

  const navItems: Array<{ id: NavSection; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'cases', label: 'Visa Cases', icon: <Briefcase className="w-4 h-4" /> },
    { id: 'kanban', label: 'Kanban Board', icon: <FolderKanban className="w-4 h-4" /> },
    ...(isStaff
      ? [
          {
            id: 'verification' as NavSection,
            label: 'Document Verification',
            icon: <FileCheck2 className="w-4 h-4" />,
          },
          {
            id: 'workflows' as NavSection,
            label: 'Workflows & Alerts',
            icon: <GitBranch className="w-4 h-4" />,
          },
        ]
      : []),
    { id: 'profile', label: 'Applicant Profile', icon: <UserCheck className="w-4 h-4" /> },
    { id: 'team', label: 'Team & Tenants', icon: <Users className="w-4 h-4" /> },
    { id: 'security', label: 'Security & Audit', icon: <Shield className="w-4 h-4" /> },
    { id: 'roadmap', label: 'Roadmap', icon: <Map className="w-4 h-4" /> },
  ];

  function selectNav(next: NavSection) {
    setSection(next);
    setSelectedCaseId(null);
    setSelectedCaseTab('overview');
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Sidebar Desktop + Mobile Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[260px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="font-display text-base font-bold tracking-tight whitespace-nowrap shrink-0">
            Meridian Visa
          </span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden p-1 text-slate-500 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 space-y-0.5">
          <div className="text-xs font-semibold truncate">{user.organizationName}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {user.fullName} · {user.isPlatformAdmin ? 'Super Admin' : ROLE_LABELS[user.role]}
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = section === item.id && !selectedCaseId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectNav(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-5 lg:px-8 py-3.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              <span>{user.organizationName}</span>
              <span className="mx-1.5">/</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {selectedCaseId ? 'Case Detail' : NAV_TITLES[section]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle color theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedCaseId(null);
                setSection('cases');
                setOpenNewCaseModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Visa Case
            </button>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-8 max-w-7xl w-full mx-auto">
          {selectedCaseId ? (
            <CaseDetailPanel
              caseId={selectedCaseId}
              currentUser={user}
              initialTab={selectedCaseTab}
              onBack={() => {
                setSelectedCaseId(null);
                setSelectedCaseTab('overview');
              }}
              onUpdated={loadWorkspaceData}
            />
          ) : section === 'overview' ? (
            <div className="space-y-8">
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight">
                  Workspace Overview
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Tenant-isolated operations for {user.organizationName} · Role: {ROLE_LABELS[user.role]}
                </p>
              </div>

              {user.role === 'APPLICANT' && onboardingCompleted === false && (
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
                    onClick={() => setSection('profile')}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    Start Onboarding
                  </button>
                </div>
              )}

              {/* 4-Column Tabular Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Active Cases</div>
                  <div className="font-display text-2xl font-bold font-mono tabular-nums">
                    {cases.length}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Scoped to current tenant
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Pending Intake / Docs</div>
                  <div className="font-display text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                    {pendingActionCount}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Awaiting applicant action
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">In Review / Ready</div>
                  <div className="font-display text-2xl font-bold font-mono tabular-nums">
                    {reviewQueueCount}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Consultant or officer queue
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Submitted / Decided</div>
                  <div className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                    {submittedCount}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {routes.length} demo routes configured
                  </div>
                </div>
              </div>

              {/* Recent Cases Table */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold">Recent Visa Applications</h2>
                  <button
                    type="button"
                    onClick={() => setSection('cases')}
                    className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    View all cases
                  </button>
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
                        <th className="py-3 px-5 font-medium text-right">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {cases.slice(0, 6).map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => {
                            setSelectedCaseTab('overview');
                            setSelectedCaseId(c.id);
                          }}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                        >
                          <td className="py-3 px-5 font-mono tabular-nums font-medium text-blue-700 dark:text-blue-400">
                            {c.reference_number}
                          </td>
                          <td className="py-3 px-5 font-medium">{c.applicant_name}</td>
                          <td className="py-3 px-5 text-slate-600 dark:text-slate-400">
                            {c.destination_country_name || c.destination_country} · {c.visa_category}
                          </td>
                          <td className={`py-3 px-5 font-medium ${statusSemanticTone(c.internal_status)}`}>
                            {STATUS_LABELS[c.internal_status]}
                          </td>
                          <td className="py-3 px-5 text-slate-500 dark:text-slate-400 font-mono">
                            {c.government_status === 'NOT_SUBMITTED'
                              ? 'Not submitted'
                              : `${c.government_status} (${c.government_status_source})`}
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
          ) : section === 'cases' || section === 'kanban' ? (
            <CasesView
              key={section}
              cases={cases}
              countries={countries}
              categories={categories}
              routes={routes}
              currentUser={user}
              initialMode={section === 'kanban' ? 'kanban' : 'table'}
              openNewModal={openNewCaseModal}
              onCloseNewModal={() => setOpenNewCaseModal(false)}
              onSelectCase={(id) => {
                setSelectedCaseTab('overview');
                setSelectedCaseId(id);
              }}
              onCreated={loadWorkspaceData}
            />
          ) : section === 'verification' && isStaff ? (
            <VerificationQueueView
              onInspectCaseDocuments={(caseId) => {
                setSelectedCaseTab('documents');
                setSelectedCaseId(caseId);
              }}
            />
          ) : section === 'workflows' && isStaff ? (
            <WorkflowTemplatesView currentUser={user} />
          ) : section === 'profile' ? (
            <ApplicantProfileView
              currentUser={user}
              countries={countries}
              categories={categories}
              onSaved={loadWorkspaceData}
            />
          ) : section === 'team' ? (
            <TeamAdminView currentUser={user} />
          ) : section === 'security' ? (
            <SecurityAuditView currentUser={user} onRefreshUser={refreshSession} />
          ) : (
            <RoadmapView />
          )}
        </main>
      </div>
    </div>
  );
}
