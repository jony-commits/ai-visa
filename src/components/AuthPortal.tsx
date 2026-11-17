import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Moon, ShieldCheck, Sun } from 'lucide-react';
import { apiRequest, setStoredToken } from '../lib/api';
import { ROLE_LABELS } from '../types';

interface DemoAccount {
  email: string;
  fullName: string;
  role: string;
  organization: string;
}

interface PublicOrg {
  id: string;
  name: string;
  slug: string;
  country_code: string;
}

interface AuthPortalProps {
  darkMode: boolean;
  onToggleDark: () => void;
  onAuthenticated: () => Promise<void>;
}

type AuthTab = 'login' | 'register' | 'invite' | 'reset';

export const AuthPortal: React.FC<AuthPortalProps> = ({
  darkMode,
  onToggleDark,
  onAuthenticated,
}) => {
  const [tab, setTab] = useState<AuthTab>('login');
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [demoPassword, setDemoPassword] = useState('');
  const [publicOrgs, setPublicOrgs] = useState<PublicOrg[]>([]);

  // Login & MFA state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  // Registration state
  const [accountType, setAccountType] = useState<'APPLICANT' | 'AGENCY_ADMIN'>('APPLICANT');
  const [fullName, setFullName] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [countryCode, setCountryCode] = useState('US');

  // Invitation state
  const [inviteToken, setInviteToken] = useState('');

  // Reset password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetTokenPreview, setResetTokenPreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<{ demoPassword: string; accounts: DemoAccount[] }>('/api/auth/demo-accounts'),
      apiRequest<{ organizations: PublicOrg[] }>('/api/auth/public-organizations'),
    ])
      .then(([demoRes, orgRes]) => {
        setDemoAccounts(demoRes.accounts);
        setDemoPassword(demoRes.demoPassword);
        setPublicOrgs(orgRes.organizations);
        if (orgRes.organizations.length > 0) {
          setOrganizationId(orgRes.organizations[0].id);
        }
      })
      .catch(() => {
        // Silent initial fetch fallback
      });
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        mfaRequired?: boolean;
        mfaChallengeToken?: string;
        token?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      if (res.mfaRequired && res.mfaChallengeToken) {
        setMfaChallengeToken(res.mfaChallengeToken);
        setNotice('Two-factor authentication is enabled. Enter your 6-digit authenticator code or backup code.');
      } else if (res.token) {
        setStoredToken(res.token);
        await onAuthenticated();
      }
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaChallengeToken) return;
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string }>('/api/auth/mfa/verify-login', {
        method: 'POST',
        body: { mfaChallengeToken, code: mfaCode },
      });
      setStoredToken(res.token);
      await onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Invalid MFA code');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickDemoLogin(demoEmail: string) {
    if (!demoPassword) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        mfaRequired?: boolean;
        mfaChallengeToken?: string;
        token?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: { email: demoEmail, password: demoPassword },
      });
      if (res.mfaRequired && res.mfaChallengeToken) {
        setEmail(demoEmail);
        setMfaChallengeToken(res.mfaChallengeToken);
      } else if (res.token) {
        setStoredToken(res.token);
        await onAuthenticated();
      }
    } catch (err: any) {
      setError(err.message || 'Demo sign in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        token: string;
        verificationTokenPreview: string;
      }>('/api/auth/register', {
        method: 'POST',
        body: {
          email,
          password,
          fullName,
          accountType,
          organizationId: accountType === 'APPLICANT' ? organizationId : undefined,
          organizationName: accountType === 'AGENCY_ADMIN' ? organizationName : undefined,
          countryCode,
        },
      });
      setStoredToken(res.token);
      setNotice(
        `Account created. Email verification token: ${res.verificationTokenPreview}`,
      );
      await onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleAcceptInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ email: string }>('/api/invitations/accept', {
        method: 'POST',
        body: { token: inviteToken, fullName, password },
      });
      setEmail(res.email);
      setTab('login');
      setNotice(`Invitation accepted for ${res.email}. You may now sign in.`);
    } catch (err: any) {
      setError(err.message || 'Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ resetTokenPreview?: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: resetEmail },
      });
      if (res.resetTokenPreview) {
        setResetTokenPreview(res.resetTokenPreview);
        setResetToken(res.resetTokenPreview);
      }
      setNotice('If an account matches that email, a password reset token has been generated.');
    } catch (err: any) {
      setError(err.message || 'Failed to request password reset');
    } finally {
      setLoading(false);
    }
  }

  async function handleCompleteReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token: resetToken, newPassword },
      });
      setTab('login');
      setNotice('Password updated and previous sessions revoked. Sign in with your new password.');
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="flex items-center justify-between gap-8 px-6 lg:px-10 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
          Meridian Visa
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() => { setTab('login'); setMfaChallengeToken(null); }}
            className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setTab('register')}
            className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => setTab('invite')}
            className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Accept Invitation
          </button>
          <button
            type="button"
            onClick={() => setTab('reset')}
            className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reset Password
          </button>
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleDark}
            aria-label="Toggle color theme"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left Architecture & Security Brief */}
        <section className="lg:col-span-5 space-y-8 pt-2">
          <div className="space-y-3">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
              Phase 1 Workspace · Multi-Tenant SaaS
            </p>
            <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
              Structured immigration operations with strict tenant isolation
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Manage applicant onboarding, encrypted passport records, versioned demonstration visa rules,
              role-gated case transitions, and full audit trails across isolated agencies.
            </p>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold">
                Demonstration Accounts
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                One-click sign-in
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Inspect role-based permissions and verify cross-tenant isolation between Apex Global Mobility and Pacific Rim Immigration.
            </p>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {demoAccounts.map((acc) => (
                <div
                  key={acc.email}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {acc.fullName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {ROLE_LABELS[acc.role] || acc.role} · {acc.organization}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleQuickDemoLogin(acc.email)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Sign In
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right Auth Card */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 lg:p-8">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg mb-6 overflow-x-auto">
            {(
              [
                ['login', 'Sign In'],
                ['register', 'Register'],
                ['invite', 'Staff Invite'],
                ['reset', 'Reset Password'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  setError(null);
                  setMfaChallengeToken(null);
                }}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === key
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-800 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {notice && (
            <div className="mb-5 p-3.5 rounded-lg border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300">
              {notice}
            </div>
          )}

          {tab === 'login' && !mfaChallengeToken && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold">Sign in to your workspace</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Access is scoped to your verified agency membership and role.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Work or Applicant Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@agency.com"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-3.5 py-2.5 pr-10 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                {loading ? 'Authenticating...' : 'Sign In'}
              </button>
            </form>
          )}

          {tab === 'login' && mfaChallengeToken && (
            <form onSubmit={handleMfaVerify} className="space-y-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                <h2 className="font-display text-lg font-semibold">Two-Factor Verification</h2>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Enter the 6-digit TOTP code from your authenticator app or a single-use backup code.
              </p>
              <input
                type="text"
                required
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="123456 or XXXX-XXXX"
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 px-4 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                >
                  {loading ? 'Verifying...' : 'Verify & Continue'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMfaChallengeToken(null);
                    setMfaCode('');
                  }}
                  className="py-2.5 px-4 text-sm font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Back
                </button>
              </div>
            </form>
          )}

          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold">Create an account</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Register as an applicant under an agency, or provision a new isolated agency tenant.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAccountType('APPLICANT')}
                  className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    accountType === 'APPLICANT'
                      ? 'border-blue-700 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Individual Applicant
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType('AGENCY_ADMIN')}
                  className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    accountType === 'AGENCY_ADMIN'
                      ? 'border-blue-700 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  New Immigration Agency
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Full Legal Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jordan Taylor"
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jordan@example.com"
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              {accountType === 'APPLICANT' ? (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Immigration Agency / Tenant</label>
                  <select
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {publicOrgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.country_code})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="block text-xs font-medium">Organization Name</label>
                    <input
                      type="text"
                      required
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="Northstar Global Counsel"
                      className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium">HQ Country</label>
                    <input
                      type="text"
                      required
                      maxLength={2}
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                      className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-medium">Password (minimum 8 characters)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
              >
                {loading
                  ? 'Provisioning Account...'
                  : accountType === 'AGENCY_ADMIN'
                    ? 'Register Agency Tenant'
                    : 'Register Applicant Account'}
              </button>
            </form>
          )}

          {tab === 'invite' && (
            <form onSubmit={handleAcceptInvite} className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold">Accept Staff Invitation</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Enter the invitation token generated by your Agency Administrator.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium">Invitation Token</label>
                <input
                  type="text"
                  required
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  placeholder="Paste hexadecimal invite token"
                  className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Full Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Set Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
              >
                {loading ? 'Activating Membership...' : 'Accept Invitation'}
              </button>
            </form>
          )}

          {tab === 'reset' && (
            <div className="space-y-6">
              <form onSubmit={handleForgotPassword} className="space-y-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                  <h2 className="font-display text-lg font-semibold">Reset Password</h2>
                </div>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="Account email address"
                    className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
                  >
                    Request Token
                  </button>
                </div>
                {resetTokenPreview && (
                  <p className="text-xs font-mono text-slate-600 dark:text-slate-400 break-all">
                    Dev reset token preview: {resetTokenPreview}
                  </p>
                )}
              </form>

              <form onSubmit={handleCompleteReset} className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">Reset Token</label>
                  <input
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">New Password (8+ chars)</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  Confirm Password Reset
                </button>
              </form>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
