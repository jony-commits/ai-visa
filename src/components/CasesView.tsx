import React, { useEffect, useState } from 'react';
import { Columns3, Plus, Search, Table2, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  formatShortDate,
  InternalCaseStatus,
  OrganizationMember,
  STATUS_LABELS,
  statusSemanticTone,
  VisaCase,
  VisaCategoryItem,
  VisaCountryItem,
  VisaRouteItem,
} from '../types';

interface CasesViewProps {
  cases: VisaCase[];
  countries: VisaCountryItem[];
  categories: VisaCategoryItem[];
  routes: VisaRouteItem[];
  currentUser: AuthUser;
  initialMode?: 'table' | 'kanban';
  openNewModal: boolean;
  onCloseNewModal: () => void;
  onSelectCase: (id: string) => void;
  onCreated: () => Promise<void>;
}

const KANBAN_COLUMNS: Array<{ title: string; statuses: InternalCaseStatus[] }> = [
  { title: 'Intake & Draft', statuses: ['DRAFT', 'APPLICANT_INFO_PENDING'] },
  { title: 'Document Collection', statuses: ['DOCUMENT_COLLECTION', 'ADDITIONAL_INFO_REQUESTED'] },
  {
    title: 'Verification & Forms',
    statuses: ['DOCUMENT_VERIFICATION', 'FORM_PREPARATION', 'RETURNED_FOR_CORRECTION'],
  },
  {
    title: 'Review & Approval',
    statuses: ['CONSULTANT_REVIEW', 'APPLICANT_APPROVAL', 'READY_FOR_SUBMISSION'],
  },
  {
    title: 'Submitted & Decision',
    statuses: ['SUBMITTED', 'AWAITING_APPOINTMENT_DECISION', 'DECISION_RECEIVED', 'APPROVED', 'REJECTED', 'CLOSED'],
  },
];

export const CasesView: React.FC<CasesViewProps> = ({
  cases,
  countries,
  categories,
  routes,
  currentUser,
  initialMode = 'table',
  openNewModal,
  onCloseNewModal,
  onSelectCase,
  onCreated,
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(initialMode);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [countryFilter, setCountryFilter] = useState('ALL');
  const [assignmentFilter, setAssignmentFilter] = useState<'ALL' | 'UNASSIGNED' | 'MINE'>('ALL');

  // Staff member directory for applicant & consultant selection
  const [members, setMembers] = useState<OrganizationMember[]>([]);

  // New case modal state
  const [destinationCountry, setDestinationCountry] = useState(countries[0]?.code || 'DE');
  const [visaCategory, setVisaCategory] = useState(categories[0]?.code || 'TOURIST');
  const [routeId, setRouteId] = useState('');
  const [applicantUserId, setApplicantUserId] = useState('');
  const [assignedConsultantId, setAssignedConsultantId] = useState('');
  const [originCountry, setOriginCountry] = useState('US');
  const [nationality, setNationality] = useState('IN');
  const [travelDate, setTravelDate] = useState('2027-06-15');
  const [purposeOfTravel, setPurposeOfTravel] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const isStaff = currentUser.role !== 'APPLICANT' || currentUser.isPlatformAdmin;
  const isAdmin = currentUser.role === 'AGENCY_ADMIN' || currentUser.isPlatformAdmin;

  useEffect(() => {
    if (isStaff && openNewModal) {
      apiRequest<{ members: OrganizationMember[] }>('/api/organizations/members')
        .then((res) => setMembers(res.members))
        .catch(() => {
          // Ignore if unavailable
        });
    }
  }, [isStaff, openNewModal]);

  const matchingRoutes = routes.filter(
    (r) => r.destination_country === destinationCountry && r.visa_category_code === visaCategory,
  );

  useEffect(() => {
    setRouteId(matchingRoutes[0]?.id || '');
  }, [destinationCountry, visaCategory]);

  const filteredCases = cases.filter((c) => {
    if (statusFilter !== 'ALL' && c.internal_status !== statusFilter) return false;
    if (categoryFilter !== 'ALL' && c.visa_category !== categoryFilter) return false;
    if (countryFilter !== 'ALL' && c.destination_country !== countryFilter) return false;
    if (assignmentFilter === 'UNASSIGNED' && c.assigned_consultant_id !== null) return false;
    if (assignmentFilter === 'MINE' && c.assigned_consultant_id !== currentUser.userId) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        c.reference_number.toLowerCase().includes(q) ||
        c.applicant_name.toLowerCase().includes(q) ||
        c.destination_country.toLowerCase().includes(q) ||
        c.route_title.toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleCreateCase(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await apiRequest('/api/cases', {
        method: 'POST',
        body: {
          destinationCountry,
          visaCategory,
          routeId: routeId || undefined,
          applicantUserId: isStaff && applicantUserId ? applicantUserId : undefined,
          assignedConsultantId:
            isAdmin && assignedConsultantId ? assignedConsultantId : undefined,
          originCountry,
          nationality,
          intendedTravelDate: travelDate || undefined,
          purposeOfTravel: purposeOfTravel || undefined,
          submissionNotes: notes || undefined,
        },
      });
      setNotes('');
      setPurposeOfTravel('');
      onCloseNewModal();
      await onCreated();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create visa case');
    } finally {
      setCreating(false);
    }
  }

  const staffOptions = members.filter((m) =>
    ['CONSULTANT', 'AGENCY_ADMIN', 'VERIFICATION_OFFICER'].includes(m.role),
  );
  const applicantOptions = members.filter((m) => m.role === 'APPLICANT');

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reference, applicant, country..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>

          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="ALL">All Countries</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="ALL">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.code} value={cat.code}>
                {cat.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="ALL">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          {isStaff && (
            <select
              value={assignmentFilter}
              onChange={(e) => setAssignmentFilter(e.target.value as 'ALL' | 'UNASSIGNED' | 'MINE')}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="ALL">All Assignees</option>
              <option value="UNASSIGNED">Unassigned Queue</option>
              <option value="MINE">Assigned to Me</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === 'table'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            Table
          </button>
          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === 'kanban'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
            Kanban
          </button>
        </div>
      </div>

      {/* Data Views */}
      {filteredCases.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-2">
          <p className="font-display text-sm font-semibold">No matching visa applications</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Adjust your filters or start a new visa case inside {currentUser.organizationName}.
          </p>
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Reference</th>
                <th className="py-3 px-4 font-medium">Applicant</th>
                <th className="py-3 px-4 font-medium">Country & Category</th>
                <th className="py-3 px-4 font-medium">Workflow Status</th>
                <th className="py-3 px-4 font-medium">Consultant</th>
                <th className="py-3 px-4 font-medium text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {filteredCases.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onSelectCase(c.id)}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <td className="py-3 px-4 font-mono tabular-nums font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap">
                    {c.reference_number}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{c.applicant_name}</div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {c.nationality} → {c.destination_country}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-slate-900 dark:text-slate-100">
                      {c.destination_country_name || c.destination_country} · {c.visa_category_name || c.visa_category}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 font-mono">
                      {c.rule_version}
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className={`font-medium ${statusSemanticTone(c.internal_status)}`}>
                      {STATUS_LABELS[c.internal_status] || c.internal_status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {c.consultant_name || 'Unassigned'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {formatShortDate(c.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4 items-start">
          {KANBAN_COLUMNS.map((col) => {
            const colItems = filteredCases.filter((c) => col.statuses.includes(c.internal_status));
            return (
              <div
                key={col.title}
                className="bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-3"
              >
                <div className="flex items-center justify-between px-1">
                  <h3 className="font-display text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {col.title}
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {colItems.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {colItems.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                      No cases
                    </div>
                  ) : (
                    colItems.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onSelectCase(c.id)}
                        className="w-full text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 rounded-lg p-3 space-y-1.5 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                            {c.reference_number}
                          </span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {c.destination_country}
                          </span>
                        </div>
                        <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                          {c.applicant_name}
                        </div>
                        <div className={`text-xs ${statusSemanticTone(c.internal_status)}`}>
                          {STATUS_LABELS[c.internal_status]}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {c.consultant_name || 'Unassigned'}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Visa Case Modal */}
      {openNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-xl w-full p-6 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">New Visa Application Case</h2>
              <button
                type="button"
                onClick={onCloseNewModal}
                aria-label="Close modal"
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateCase} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Destination Country</label>
                  <select
                    value={destinationCountry}
                    onChange={(e) => setDestinationCountry(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Visa Category</label>
                  <select
                    value={visaCategory}
                    onChange={(e) => setVisaCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {categories.map((cat) => (
                      <option key={cat.code} value={cat.code}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                {matchingRoutes.length > 0 ? (
                  <>
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      Matched Rule Version: {matchingRoutes[0].title}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      Demonstration rule ({matchingRoutes[0].rule_version}) — verify current policy before filing.
                    </div>
                  </>
                ) : (
                  <div className="text-slate-500 dark:text-slate-400">
                    No pre-published rule version for {destinationCountry} / {visaCategory}. Case will initialize as unconfigured intake until staff publish rules in Phase 2.
                  </div>
                )}
              </div>

              {isStaff && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium">Applicant (Same Tenant)</label>
                    <select
                      value={applicantUserId}
                      onChange={(e) => setApplicantUserId(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">Create for myself ({currentUser.fullName})</option>
                      {applicantOptions.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name} ({m.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  {isAdmin && (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium">Assign Consultant</label>
                      <select
                        value={assignedConsultantId}
                        onChange={(e) => setAssignedConsultantId(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="">Leave unassigned (Admin queue)</option>
                        {staffOptions.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.full_name} ({m.role})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Origin Country</label>
                  <select
                    value={originCountry}
                    onChange={(e) => setOriginCountry(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Nationality</label>
                  <select
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Target Travel</label>
                  <input
                    type="date"
                    value={travelDate}
                    onChange={(e) => setTravelDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium">Purpose of Travel</label>
                <input
                  type="text"
                  value={purposeOfTravel}
                  onChange={(e) => setPurposeOfTravel(e.target.value)}
                  placeholder="e.g., Executive client meetings or academic semester"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium">Case Intake Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Urgency, prior visas, or special circumstances..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onCloseNewModal}
                  className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {creating ? 'Creating...' : 'Create Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
