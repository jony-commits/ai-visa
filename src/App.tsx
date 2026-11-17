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
  SlidersHorizontal,
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
import { RoleDashboardView } from './components/RoleDashboardView';
import { RuleFormBuilderView } from './components/RuleFormBuilderView';
import { SecurityAuditView } from './components/SecurityAuditView';
import { TeamAdminView } from './components/TeamAdminView';
import { VerificationQueueView } from './components/VerificationQueueView';
import { WorkflowTemplatesView } from './components/WorkflowTemplatesView';
import { apiRequest, setStoredToken } from './lib/api';
import {
  AuthUser,
  ROLE_LABELS,
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
  | 'rules'
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
  rules: 'Country Rule Engine & Form Builder',
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
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

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
    setWorkspaceError(null);
    try {
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
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed to load workspace cases and catalog data.');
    }
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
          {
            id: 'rules' as NavSection,
            label: 'Rules & Form Builder',
            icon: <SlidersHorizontal className="w-4 h-4" />,
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

        <main className="flex-1 p-5 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {workspaceError && (
            <div
              role="alert"
              className="p-4 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 flex flex-wrap items-center justify-between gap-3 text-xs text-red-800 dark:text-red-300"
            >
              <span>{workspaceError}</span>
              <button
                type="button"
                onClick={loadWorkspaceData}
                className="px-3 py-1.5 font-medium border border-red-400 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 cursor-pointer"
              >
                Retry Load
              </button>
            </div>
          )}

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
            <RoleDashboardView
              user={user}
              cases={cases}
              routes={routes}
              onboardingCompleted={onboardingCompleted}
              onSelectCase={(caseId, tab = 'overview') => {
                setSelectedCaseTab(tab);
                setSelectedCaseId(caseId);
              }}
              onNavigate={(next) => selectNav(next)}
            />
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
          ) : section === 'rules' && isStaff ? (
            <RuleFormBuilderView
              currentUser={user}
              countries={countries}
              categories={categories}
              onCatalogUpdated={loadWorkspaceData}
            />
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
