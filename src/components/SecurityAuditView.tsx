import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, MailCheck, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { AuditLogItem, AuthUser, formatShortDate } from '../types';

interface SecurityAuditViewProps {
  currentUser: AuthUser;
  onRefreshUser: () => Promise<void>;
}

export const SecurityAuditView: React.FC<SecurityAuditViewProps> = ({
  currentUser,
  onRefreshUser,
}) => {
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [otpAuthUri, setOtpAuthUri] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');

  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [verifyPreview, setVerifyPreview] = useState<string | null>(null);

  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditResourceFilter, setAuditResourceFilter] = useState('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canViewAuditLogs =
    currentUser.role === 'AGENCY_ADMIN' ||
    currentUser.role === 'VERIFICATION_OFFICER' ||
    currentUser.isPlatformAdmin;

  const loadAuditLogs = useCallback(async () => {
    if (!canViewAuditLogs) return;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const qs = new URLSearchParams();
      if (auditResourceFilter !== 'ALL') qs.set('resourceType', auditResourceFilter);
      if (auditSearch.trim()) qs.set('search', auditSearch.trim());
      const res = await apiRequest<{ logs: AuditLogItem[] }>(
        `/api/audit-logs${qs.toString() ? `?${qs.toString()}` : ''}`,
      );
      setAuditLogs(res.logs);
    } catch (err: any) {
      setAuditError(err.message || 'Failed to load security audit trail.');
    } finally {
      setAuditLoading(false);
    }
  }, [auditResourceFilter, auditSearch, canViewAuditLogs]);

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  async function handleStartMfaSetup() {
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ secret: string; otpAuthUri: string }>('/api/auth/mfa/setup', {
        method: 'POST',
      });
      setMfaSecret(res.secret);
      setOtpAuthUri(res.otpAuthUri);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleEnableMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ backupCodes: string[] }>('/api/auth/mfa/enable', {
        method: 'POST',
        body: { code: totpCode },
      });
      setBackupCodes(res.backupCodes);
      setMfaSecret(null);
      setOtpAuthUri(null);
      setTotpCode('');
      setNotice('Two-factor authentication enabled. Store your backup codes securely.');
      await onRefreshUser();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDisableMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/api/auth/mfa/disable', {
        method: 'POST',
        body: { password: disablePassword },
      });
      setDisablePassword('');
      setBackupCodes(null);
      setNotice('Two-factor authentication disabled.');
      await onRefreshUser();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleResendVerification() {
    setError(null);
    try {
      const res = await apiRequest<{ verificationTokenPreview: string }>(
        '/api/auth/resend-verification',
        { method: 'POST' },
      );
      setVerifyPreview(res.verificationTokenPreview);
      setVerifyTokenInput(res.verificationTokenPreview);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleVerifyEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: { token: verifyTokenInput },
      });
      setNotice('Email address verified.');
      await onRefreshUser();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display text-2xl font-bold">Security & Audit Trail</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Manage email verification, TOTP multi-factor authentication, and review tenant security events.
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

      {/* Email Verification */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <MailCheck className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold">Email Verification</h2>
          </div>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {currentUser.emailVerified ? 'Verified' : 'Unverified'}
          </span>
        </div>

        {!currentUser.emailVerified && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleResendVerification}
              className="px-3.5 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Generate Verification Token
            </button>
            {verifyPreview && (
              <p className="text-xs font-mono text-slate-500 break-all">
                Token preview: {verifyPreview}
              </p>
            )}
            <form onSubmit={handleVerifyEmail} className="flex gap-2">
              <input
                type="text"
                required
                value={verifyTokenInput}
                onChange={(e) => setVerifyTokenInput(e.target.value)}
                placeholder="Paste verification token"
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                Verify Email
              </button>
            </form>
          </div>
        )}
      </section>

      {/* TOTP MFA */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold">
              Multi-Factor Authentication (RFC 6238 TOTP)
            </h2>
          </div>
          <span className="text-xs font-medium">
            {currentUser.mfaEnabled ? 'Active' : 'Disabled'}
          </span>
        </div>

        {!currentUser.mfaEnabled && !mfaSecret && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Protect sensitive applicant records with time-based one-time passwords via any standard authenticator app.
            </p>
            <button
              type="button"
              onClick={handleStartMfaSetup}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Configure Authenticator App
            </button>
          </div>
        )}

        {mfaSecret && (
          <form onSubmit={handleEnableMfa} className="space-y-4">
            <div className="p-4 rounded-lg bg-slate-100 dark:bg-slate-800 space-y-2 text-xs">
              <div>
                <strong>Base32 Secret:</strong>{' '}
                <span className="font-mono select-all">{mfaSecret}</span>
              </div>
              {otpAuthUri && (
                <div className="break-all text-slate-600 dark:text-slate-300 font-mono">
                  {otpAuthUri}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="Enter 6-digit code"
                className="px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                Verify & Activate MFA
              </button>
            </div>
          </form>
        )}

        {backupCodes && (
          <div className="p-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 space-y-2">
            <div className="text-xs font-semibold">Single-Use Recovery Backup Codes</div>
            <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
              {backupCodes.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
          </div>
        )}

        {currentUser.mfaEnabled && (
          <form onSubmit={handleDisableMfa} className="flex flex-wrap items-center gap-2 pt-2">
            <input
              type="password"
              required
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Confirm current password to disable MFA"
              className="flex-1 min-w-[240px] px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg cursor-pointer"
            >
              Disable MFA
            </button>
          </form>
        )}
      </section>

      {/* Audit Logs */}
      {canViewAuditLogs && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">Tenant Security Audit Log</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {currentUser.isPlatformAdmin
                  ? 'Platform-wide security and workflow audit events'
                  : `Immutable audit events scoped to ${currentUser.organizationName}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search actor, action, ID..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <select
                value={auditResourceFilter}
                onChange={(e) => setAuditResourceFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="ALL">All Resources</option>
                <option value="VisaApplication">VisaApplication</option>
                <option value="ApplicationDocument">ApplicationDocument</option>
                <option value="ApplicationForm">ApplicationForm</option>
                <option value="Organization">Organization</option>
                <option value="User">User</option>
                <option value="Invitation">Invitation</option>
              </select>
              <button
                type="button"
                onClick={loadAuditLogs}
                disabled={auditLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {auditError && (
            <div
              role="alert"
              className="m-4 p-3 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 flex items-center justify-between gap-2 text-xs text-red-700 dark:text-red-300"
            >
              <span>{auditError}</span>
              <button
                type="button"
                onClick={loadAuditLogs}
                className="px-2.5 py-1 font-medium border border-red-400 dark:border-red-700 rounded cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {auditLoading && auditLogs.length === 0 ? (
            <div className="p-6 space-y-2">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="h-9 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
              ))}
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No audit log entries match the selected filters.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-medium">Timestamp</th>
                  <th className="py-3 px-4 font-medium">Actor</th>
                  <th className="py-3 px-4 font-medium">Action</th>
                  <th className="py-3 px-4 font-medium">Resource</th>
                  <th className="py-3 px-4 font-medium text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {auditLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {formatShortDate(log.created_at)}
                        </td>
                        <td className="py-2.5 px-4">
                          {log.actor_email || 'System'}
                          {log.organization_name && currentUser.isPlatformAdmin
                            ? ` · ${log.organization_name}`
                            : ''}
                        </td>
                        <td className="py-2.5 px-4 font-mono">{log.action}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-500">
                          {log.resource_type}
                          {log.resource_id ? ` · ${log.resource_id}` : ''}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {log.metadata_json ? (
                            <button
                              type="button"
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              {isExpanded ? 'Hide' : 'Inspect'}
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && log.metadata_json && (
                        <tr className="bg-slate-50 dark:bg-slate-950/60">
                          <td colSpan={5} className="px-4 py-2.5">
                            <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all">
                              {log.metadata_json}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
};
