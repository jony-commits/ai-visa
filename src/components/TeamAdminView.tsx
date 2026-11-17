import React, { useEffect, useState } from 'react';
import { Building2, UserPlus } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  formatShortDate,
  InvitationItem,
  OrganizationMember,
  OrganizationRole,
  ROLE_LABELS,
} from '../types';

interface TeamAdminViewProps {
  currentUser: AuthUser;
}

export const TeamAdminView: React.FC<TeamAdminViewProps> = ({ currentUser }) => {
  const [org, setOrg] = useState<any>(null);
  const [orgName, setOrgName] = useState('');
  const [orgCountry, setOrgCountry] = useState('US');
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrganizationRole>('CONSULTANT');
  const [invitePreview, setInvitePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isAdmin = currentUser.role === 'AGENCY_ADMIN' || currentUser.isPlatformAdmin;

  async function loadAll() {
    setError(null);
    try {
      const orgRes = await apiRequest<{ organization: any }>('/api/organizations/current');
      setOrg(orgRes.organization);
      setOrgName(orgRes.organization.name);
      setOrgCountry(orgRes.organization.country_code);

      if (currentUser.role !== 'APPLICANT' || currentUser.isPlatformAdmin) {
        const memRes = await apiRequest<{
          members: OrganizationMember[];
          invitations: InvitationItem[];
        }>('/api/organizations/members');
        setMembers(memRes.members);
        setInvitations(memRes.invitations);
      }

      if (currentUser.isPlatformAdmin) {
        const tenantRes = await apiRequest<{ tenants: any[] }>('/api/admin/tenants');
        setTenants(tenantRes.tenants);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load organization details');
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSaveOrg(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/api/organizations/current', {
        method: 'PATCH',
        body: { name: orgName, countryCode: orgCountry },
      });
      setNotice('Organization settings updated.');
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setInvitePreview(null);
    try {
      const res = await apiRequest<{ inviteTokenPreview: string }>(
        '/api/organizations/invitations',
        {
          method: 'POST',
          body: { email: inviteEmail, role: inviteRole },
        },
      );
      setInvitePreview(res.inviteTokenPreview);
      setInviteEmail('');
      setNotice('Invitation created.');
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRoleChange(memberId: string, role: OrganizationRole) {
    setError(null);
    try {
      await apiRequest(`/api/organizations/members/${memberId}/role`, {
        method: 'PATCH',
        body: { role },
      });
      setNotice('Member role updated.');
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleTenantStatus(orgId: string, status: 'ACTIVE' | 'SUSPENDED') {
    setError(null);
    try {
      await apiRequest(`/api/admin/tenants/${orgId}/status`, {
        method: 'PATCH',
        body: { status },
      });
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display text-2xl font-bold">Organization & Team Access</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Tenant boundary: {currentUser.organizationName} · Slug: <span className="font-mono">{currentUser.organizationSlug}</span>
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-lg border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {/* Organization Settings */}
      {org && (
        <form
          onSubmit={handleSaveOrg}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold">Tenant Configuration</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block text-xs font-medium">Organization Name</label>
              <input
                type="text"
                disabled={!isAdmin}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Country Code</label>
              <input
                type="text"
                maxLength={2}
                disabled={!isAdmin}
                value={orgCountry}
                onChange={(e) => setOrgCountry(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
              />
            </div>
          </div>
          {isAdmin && (
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
            >
              Update Organization
            </button>
          )}
        </form>
      )}

      {/* Invite Consultant / Staff */}
      {isAdmin && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold">Invite Team Member</h2>
          </div>
          <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-6 space-y-1">
              <label className="block text-xs font-medium">Staff Email</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="consultant@agency.com"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="sm:col-span-4 space-y-1">
              <label className="block text-xs font-medium">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrganizationRole)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="CONSULTANT">Visa Consultant</option>
                <option value="VERIFICATION_OFFICER">Verification Officer</option>
                <option value="AGENCY_ADMIN">Agency Administrator</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="w-full py-2 px-3 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                Send Invite
              </button>
            </div>
          </form>

          {invitePreview && (
            <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-mono break-all">
              Invitation Token Preview (share with invitee): {invitePreview}
            </div>
          )}

          {invitations.length > 0 && (
            <div className="pt-2 divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {invitations.map((inv) => (
                <div key={inv.id} className="py-2 flex items-center justify-between gap-3">
                  <span>
                    {inv.email} · {ROLE_LABELS[inv.role]}
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    {inv.accepted_at ? `Accepted ${formatShortDate(inv.accepted_at)}` : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Members Directory */}
      {members.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold">Tenant Members</h2>
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Name</th>
                <th className="py-3 px-4 font-medium">Email</th>
                <th className="py-3 px-4 font-medium">MFA</th>
                <th className="py-3 px-4 font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {members.map((m) => (
                <tr key={m.member_id}>
                  <td className="py-3 px-4 font-medium">{m.full_name}</td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{m.email}</td>
                  <td className="py-3 px-4 font-mono">
                    {m.mfa_enabled ? 'Enabled' : 'Disabled'}
                  </td>
                  <td className="py-3 px-4">
                    {isAdmin ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.member_id, e.target.value as OrganizationRole)}
                        className="px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="APPLICANT">Applicant</option>
                        <option value="CONSULTANT">Visa Consultant</option>
                        <option value="VERIFICATION_OFFICER">Verification Officer</option>
                        <option value="AGENCY_ADMIN">Agency Administrator</option>
                      </select>
                    ) : (
                      <span>{ROLE_LABELS[m.role] || m.role}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Super Admin Tenant Governance */}
      {currentUser.isPlatformAdmin && tenants.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold">
              Platform Super Admin — Tenant Governance
            </h2>
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Organization</th>
                <th className="py-3 px-4 font-medium">Plan</th>
                <th className="py-3 px-4 font-medium text-right">Members</th>
                <th className="py-3 px-4 font-medium text-right">Cases</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td className="py-3 px-4">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-slate-500 font-mono">{t.slug}</div>
                  </td>
                  <td className="py-3 px-4 font-mono">{t.plan_tier}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{t.member_count}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{t.case_count}</td>
                  <td className="py-3 px-4 font-medium">{t.status}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        handleTenantStatus(t.id, t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')
                      }
                      className="px-3 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {t.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
};
