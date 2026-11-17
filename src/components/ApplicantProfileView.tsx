import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { AuthUser, VisaCategoryItem, VisaCountryItem } from '../types';

interface DependentItem {
  name: string;
  relationship: string;
  dateOfBirth: string;
}

interface ApplicantProfileViewProps {
  currentUser: AuthUser;
  countries: VisaCountryItem[];
  categories: VisaCategoryItem[];
  onSaved?: () => Promise<void> | void;
}

type StepIndex = 1 | 2 | 3 | 4;

const STEPS: Array<{ step: StepIndex; label: string }> = [
  { step: 1, label: '01. Identity & Residence' },
  { step: 2, label: '02. Passport Record' },
  { step: 3, label: '03. Travel & Dependents' },
  { step: 4, label: '04. Consents & Review' },
];

export const ApplicantProfileView: React.FC<ApplicantProfileViewProps> = ({
  currentUser,
  countries,
  categories,
  onSaved,
}) => {
  const [step, setStep] = useState<StepIndex>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({
    identity: false,
    passport: false,
    travel: false,
    consent: false,
  });

  const [fullLegalName, setFullLegalName] = useState(currentUser.fullName);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nationality, setNationality] = useState('IN');
  const [residenceCountry, setResidenceCountry] = useState('US');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(currentUser.email);
  const [travelDestination, setTravelDestination] = useState('DE');
  const [visaCategory, setVisaCategory] = useState('TOURIST');
  const [intendedTravelStart, setIntendedTravelStart] = useState('');
  const [intendedTravelEnd, setIntendedTravelEnd] = useState('');
  const [purposeOfTravel, setPurposeOfTravel] = useState('');
  const [dependents, setDependents] = useState<DependentItem[]>([]);

  // Passport fields (encrypted at rest server-side)
  const [maskedPassport, setMaskedPassport] = useState<string | null>(null);
  const [passportNumberInput, setPassportNumberInput] = useState('');
  const [issuingCountry, setIssuingCountry] = useState('IN');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  // Consents
  const [consentPersonal, setConsentPersonal] = useState(true);
  const [consentAi, setConsentAi] = useState(false);
  const [consentComms, setConsentComms] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<{
      profile: any;
      passport: any;
      consents: Array<{ consent_type: string; granted: number }>;
      onboardingChecklist?: {
        identity: boolean;
        passport: boolean;
        travel: boolean;
        consent: boolean;
      };
    }>('/api/applicant/profile')
      .then((res) => {
        if (res.profile) {
          setFullLegalName(res.profile.full_legal_name || currentUser.fullName);
          setDateOfBirth(res.profile.date_of_birth || '');
          setNationality(res.profile.nationality || 'IN');
          setResidenceCountry(res.profile.residence_country || 'US');
          setPhone(res.profile.phone || '');
          setEmail(res.profile.email || currentUser.email);
          setTravelDestination(res.profile.travel_destination || 'DE');
          setVisaCategory(res.profile.visa_category || 'TOURIST');
          setIntendedTravelStart(res.profile.intended_travel_start || '');
          setIntendedTravelEnd(res.profile.intended_travel_end || '');
          setPurposeOfTravel(res.profile.purpose_of_travel || '');
          setDependents(res.profile.dependents || []);
        }
        if (res.passport) {
          setMaskedPassport(res.passport.passport_number_masked);
          setIssuingCountry(res.passport.issuing_country || 'IN');
          setIssueDate(res.passport.issue_date || '');
          setExpiryDate(res.passport.expiry_date || '');
        }
        if (res.consents && res.consents.length > 0) {
          for (const c of res.consents) {
            if (c.consent_type === 'PERSONAL_DATA_PROCESSING') setConsentPersonal(Boolean(c.granted));
            if (c.consent_type === 'EXTERNAL_AI_PROCESSING') setConsentAi(Boolean(c.granted));
            if (c.consent_type === 'COMMUNICATIONS') setConsentComms(Boolean(c.granted));
          }
        }
        if (res.onboardingChecklist) {
          setChecklist(res.onboardingChecklist);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [currentUser.email, currentUser.fullName]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setSavedMsg(null);
    try {
      const res = await fetch('/api/applicant/profile', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(window.sessionStorage.getItem('meridian_auth_token')
            ? { Authorization: `Bearer ${window.sessionStorage.getItem('meridian_auth_token')}` }
            : {}),
        },
        body: JSON.stringify({
          fullLegalName,
          dateOfBirth,
          nationality,
          residenceCountry,
          phone,
          email,
          travelDestination,
          visaCategory,
          intendedTravelStart,
          intendedTravelEnd,
          purposeOfTravel,
          dependents,
          passport:
            issuingCountry && issueDate && expiryDate
              ? {
                  passportNumber: passportNumberInput.trim() || undefined,
                  issuingCountry,
                  issueDate,
                  expiryDate,
                }
              : undefined,
          consents: {
            PERSONAL_DATA_PROCESSING: consentPersonal,
            EXTERNAL_AI_PROCESSING: consentAi,
            COMMUNICATIONS: consentComms,
          },
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error || 'Validation failed');
        setFieldErrors(payload.fieldErrors || {});
        return;
      }
      if (payload.passport) {
        setMaskedPassport(payload.passport.passport_number_masked);
      }
      setPassportNumberInput('');
      setChecklist({
        identity: true,
        passport: Boolean(payload.passport),
        travel: true,
        consent: consentPersonal,
      });
      setSavedMsg('Onboarding profile, encrypted passport record, and consent preferences saved.');
      if (onSaved) {
        await onSaved();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save applicant profile');
    } finally {
      setSaving(false);
    }
  }

  async function handleExportJson() {
    try {
      const data = await apiRequest('/api/applicant/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `meridian-personal-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to export personal data');
    }
  }

  if (loading) {
    return <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse" />;
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Applicant Onboarding & Profile</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Complete all four onboarding sections. Passport identifiers are AES-256-GCM encrypted at rest and masked on retrieval.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportJson}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Export My Data (JSON)
        </button>
      </div>

      {/* Stepper Tabs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
        {STEPS.map((item) => {
          const isDone =
            (item.step === 1 && checklist.identity) ||
            (item.step === 2 && checklist.passport) ||
            (item.step === 3 && checklist.travel) ||
            (item.step === 4 && checklist.consent);
          const active = step === item.step;
          return (
            <button
              key={item.step}
              type="button"
              onClick={() => setStep(item.step)}
              className={`flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                active
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="truncate">{item.label}</span>
              {isDone && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 space-y-1">
          <div className="font-semibold">{error}</div>
          {Object.keys(fieldErrors).length > 1 && (
            <ul className="list-disc pl-4 space-y-0.5">
              {Object.entries(fieldErrors).map(([k, msg]) => (
                <li key={k}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {savedMsg && (
        <div className="p-3.5 rounded-lg border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300">
          {savedMsg}
        </div>
      )}

      {/* Step 1: Personal Identity */}
      {step === 1 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold">01. Identity & Residence</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Full Legal Name</label>
              <input
                type="text"
                required
                value={fullLegalName}
                onChange={(e) => setFullLegalName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              {fieldErrors.fullLegalName && (
                <p className="text-xs text-red-600">{fieldErrors.fullLegalName}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Date of Birth</label>
              <input
                type="date"
                required
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              {fieldErrors.dateOfBirth && (
                <p className="text-xs text-red-600">{fieldErrors.dateOfBirth}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Phone Number</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1-415-555-0100"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              {fieldErrors.phone && <p className="text-xs text-red-600">{fieldErrors.phone}</p>}
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
              <label className="block text-xs font-medium">Current Residence Country</label>
              <select
                value={residenceCountry}
                onChange={(e) => setResidenceCountry(e.target.value)}
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
              <label className="block text-xs font-medium">Contact Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>
        </section>
      )}

      {/* Step 2: Encrypted Passport Record */}
      {step === 2 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold">
                02. Passport Record (Encrypted at Rest)
              </h2>
            </div>
            {maskedPassport && (
              <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                Stored: {maskedPassport}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">
                {maskedPassport ? 'Replace Passport Number' : 'Passport Number'}
              </label>
              <input
                type="text"
                value={passportNumberInput}
                onChange={(e) => setPassportNumberInput(e.target.value)}
                placeholder={maskedPassport ? 'Leave blank to keep current' : 'e.g., Z9482714'}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              {fieldErrors['passport.passportNumber'] && (
                <p className="text-xs text-red-600">{fieldErrors['passport.passportNumber']}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Issuing Country</label>
              <select
                value={issuingCountry}
                onChange={(e) => setIssuingCountry(e.target.value)}
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
              <label className="block text-xs font-medium">Issue Date</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              {fieldErrors['passport.issueDate'] && (
                <p className="text-xs text-red-600">{fieldErrors['passport.issueDate']}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Expiry Date</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              {fieldErrors['passport.expiryDate'] && (
                <p className="text-xs text-red-600">{fieldErrors['passport.expiryDate']}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Step 3: Travel & Dependents */}
      {step === 3 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold">
            03. Destination, Visa Category & Dependents
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Travel Destination</label>
              <select
                value={travelDestination}
                onChange={(e) => setTravelDestination(e.target.value)}
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
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Intended Arrival</label>
              <input
                type="date"
                value={intendedTravelStart}
                onChange={(e) => setIntendedTravelStart(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Intended Departure</label>
              <input
                type="date"
                value={intendedTravelEnd}
                onChange={(e) => setIntendedTravelEnd(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              {fieldErrors.intendedTravelEnd && (
                <p className="text-xs text-red-600">{fieldErrors.intendedTravelEnd}</p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium">Purpose of Travel</label>
            <textarea
              rows={2}
              value={purposeOfTravel}
              onChange={(e) => setPurposeOfTravel(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <div className="pt-2 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Accompanying Family / Dependents</span>
              <button
                type="button"
                onClick={() =>
                  setDependents((prev) => [
                    ...prev,
                    { name: '', relationship: 'Spouse', dateOfBirth: '' },
                  ])
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                Add Dependent
              </button>
            </div>
            {dependents.map((dep, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-7 gap-2 items-center">
                <input
                  type="text"
                  placeholder="Full legal name"
                  value={dep.name}
                  onChange={(e) =>
                    setDependents((prev) =>
                      prev.map((d, i) => (i === idx ? { ...d, name: e.target.value } : d)),
                    )
                  }
                  className="sm:col-span-3 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <input
                  type="text"
                  placeholder="Relationship"
                  value={dep.relationship}
                  onChange={(e) =>
                    setDependents((prev) =>
                      prev.map((d, i) => (i === idx ? { ...d, relationship: e.target.value } : d)),
                    )
                  }
                  className="sm:col-span-2 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <input
                  type="date"
                  value={dep.dateOfBirth}
                  onChange={(e) =>
                    setDependents((prev) =>
                      prev.map((d, i) => (i === idx ? { ...d, dateOfBirth: e.target.value } : d)),
                    )
                  }
                  className="sm:col-span-1 px-2 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <button
                  type="button"
                  aria-label="Remove dependent"
                  onClick={() => setDependents((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-1.5 text-slate-400 hover:text-red-600 justify-self-end cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Step 4: Consent & Review */}
      {step === 4 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <h2 className="font-display text-base font-semibold">04. Data Consent & Summary Review</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Applicant:</span>{' '}
              <span className="font-medium">{fullLegalName}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Date of Birth:</span>{' '}
              <span className="font-mono tabular-nums">{dateOfBirth || 'Not set'}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Nationality / Residence:</span>{' '}
              <span className="font-mono">
                {nationality} / {residenceCountry}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Destination & Category:</span>{' '}
              <span className="font-mono">
                {travelDestination} · {visaCategory}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Passport:</span>{' '}
              <span className="font-mono">
                {passportNumberInput
                  ? 'New passport entered (will encrypt on save)'
                  : maskedPassport || 'Not provided yet'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Dependents:</span>{' '}
              <span className="font-mono tabular-nums">{dependents.length}</span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-start gap-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={consentPersonal}
                onChange={(e) => setConsentPersonal(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Personal Data Processing (Required):</strong> I authorize my immigration organization to process my identity and travel information solely for visa case preparation.
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={consentAi}
                onChange={(e) => setConsentAi(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>External AI Extraction & Prefill (Optional):</strong> Allow server-side AI extraction and form suggestions (all AI outputs remain unverified until reviewed by me or an authorized officer).
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={consentComms}
                onChange={(e) => setConsentComms(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Case Notifications:</strong> Receive reminders for missing documents, deadlines, and appointments.
              </span>
            </label>
          </div>
        </section>
      )}

      {/* Navigation & Save Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as StepIndex) : s))}
            className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Previous
          </button>
          {step < 4 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s < 4 ? ((s + 1) as StepIndex) : s))}
              className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Next Step
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Encrypting & Saving...' : 'Save Onboarding Profile'}
        </button>
      </div>
    </form>
  );
};
