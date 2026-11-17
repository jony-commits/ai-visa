import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  FileSearch,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  ApplicationDocumentItem,
  AuthUser,
  DOCUMENT_TYPE_LABELS,
  DocumentRequirementItem,
  DocumentVerificationSummary,
  formatBytes,
  formatShortDate,
  ProcessingJobItem,
  statusSemanticTone,
  VerificationIssueItem,
} from '../types';

interface CaseDocumentsPanelProps {
  caseId: string;
  currentUser: AuthUser;
  onUpdated?: () => void;
}

const EDITABLE_FIELD_KEYS: Array<{ key: string; label: string; placeholder?: string }> = [
  { key: 'fullName', label: 'Full Legal Name' },
  { key: 'dateOfBirth', label: 'Date of Birth (YYYY-MM-DD)', placeholder: 'YYYY-MM-DD' },
  { key: 'nationality', label: 'Nationality (ISO-2)', placeholder: 'e.g. IN' },
  { key: 'passportNumber', label: 'Passport Number' },
  { key: 'issuingCountry', label: 'Issuing Country (ISO-2)' },
  { key: 'issueDate', label: 'Issue Date (YYYY-MM-DD)', placeholder: 'YYYY-MM-DD' },
  { key: 'expiryDate', label: 'Expiry Date (YYYY-MM-DD)', placeholder: 'YYYY-MM-DD' },
  { key: 'bankName', label: 'Bank / Financial Institution' },
  { key: 'accountHolderName', label: 'Account Holder Name' },
  { key: 'closingBalance', label: 'Closing Balance' },
  { key: 'currency', label: 'Currency (ISO-3)', placeholder: 'EUR / USD' },
  { key: 'statementDate', label: 'Statement Date', placeholder: 'YYYY-MM-DD' },
  { key: 'employerName', label: 'Employer Name' },
  { key: 'jobTitle', label: 'Job Title / Position' },
  { key: 'annualSalary', label: 'Annual Salary' },
];

export const CaseDocumentsPanel: React.FC<CaseDocumentsPanelProps> = ({
  caseId,
  currentUser,
  onUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [requirements, setRequirements] = useState<DocumentRequirementItem[]>([]);
  const [documents, setDocuments] = useState<ApplicationDocumentItem[]>([]);
  const [verification, setVerification] = useState<DocumentVerificationSummary | null>(null);
  const [issues, setIssues] = useState<VerificationIssueItem[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobItem[]>([]);

  // Upload state
  const [selectedReqCode, setSelectedReqCode] = useState<string>('');
  const [documentType, setDocumentType] = useState<string>('PASSPORT');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Workbench & Modal state
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [previewDoc, setPreviewDoc] = useState<{
    filename: string;
    mimeType: string;
    url: string;
  } | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const isStaff = currentUser.role !== 'APPLICANT' || currentUser.isPlatformAdmin;

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        documents: ApplicationDocumentItem[];
        requirements: DocumentRequirementItem[];
        verification: DocumentVerificationSummary | null;
        issues: VerificationIssueItem[];
        jobs: ProcessingJobItem[];
      }>(`/api/cases/${caseId}/documents`);

      setDocuments(res.documents);
      setRequirements(res.requirements);
      setVerification(res.verification);
      setIssues(res.issues);
      setJobs(res.jobs);
    } catch (err: any) {
      setError(err.message || 'Failed to load case documents');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const activeDoc = documents.find((d) => d.id === activeDocId) || null;

  useEffect(() => {
    if (!activeDoc) {
      setEditFields({});
      setReviewNotes('');
      return;
    }
    const effective = activeDoc.extraction?.corrected?.fields || activeDoc.extraction?.extracted?.fields || {};
    setEditFields({ ...effective });
    setReviewNotes(activeDoc.reviewNotes || '');
  }, [activeDocId, documents]);

  function handleSelectRequirement(reqItem: DocumentRequirementItem) {
    setSelectedReqCode(reqItem.requirement_code);
    setDocumentType(reqItem.document_type);
    setNotice(`Uploader targeted for: ${reqItem.title}`);
  }

  async function uploadFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setError('File exceeds the 10 MB maximum upload size.');
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const base64Content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(new Error('Failed to read selected file'));
        reader.readAsDataURL(file);
      });

      const res = await apiRequest<{
        document: ApplicationDocumentItem;
      }>(`/api/cases/${caseId}/documents`, {
        method: 'POST',
        body: {
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64: base64Content,
          documentType,
          requirementCode: selectedReqCode || undefined,
          expiryDate: expiryDate || undefined,
        },
      });

      setExpiryDate('');
      setActiveDocId(res.document.id);
      setNotice(
        `Uploaded "${res.document.originalFilename}" (v${res.document.version}). Security scan, OCR extraction, and cross-document checks completed.`,
      );
      await loadDocuments();
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Document upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveExtraction(confirm: boolean) {
    if (!activeDoc) return;
    setBusyAction(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/documents/${activeDoc.id}/extraction`, {
        method: 'PATCH',
        body: {
          fields: editFields,
          confirm,
        },
      });
      setNotice(
        confirm
          ? 'Extracted fields saved and marked as human-confirmed. Verification checks updated.'
          : 'Manual field corrections saved (raw OCR text preserved separately).',
      );
      await loadDocuments();
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to save extraction corrections');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleRerunExtraction(docId: string) {
    setBusyAction(true);
    setError(null);
    try {
      await apiRequest(`/api/documents/${docId}/extract`, { method: 'POST' });
      setNotice('OCR extraction and cross-document consistency pipeline re-executed.');
      await loadDocuments();
    } catch (err: any) {
      setError(err.message || 'Extraction re-run failed');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleReviewDocument(status: 'VERIFIED' | 'NEEDS_CORRECTION' | 'REJECTED') {
    if (!activeDoc) return;
    setBusyAction(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/documents/${activeDoc.id}/review`, {
        method: 'PATCH',
        body: {
          reviewStatus: status,
          reviewNotes,
        },
      });
      setNotice(`Officer decision recorded: ${status}. Checklist and case verification synced.`);
      await loadDocuments();
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to save officer review');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleRunVerification() {
    setBusyAction(true);
    setError(null);
    try {
      await apiRequest(`/api/cases/${caseId}/verify`, { method: 'POST' });
      setNotice('Cross-document consistency verification job completed.');
      await loadDocuments();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleIssueAction(issueId: string, status: 'RESOLVED' | 'OVERRIDDEN') {
    setBusyAction(true);
    setError(null);
    try {
      await apiRequest(`/api/verification-issues/${issueId}`, {
        method: 'PATCH',
        body: {
          status,
          resolutionNote: `Marked ${status.toLowerCase()} by ${currentUser.fullName}`,
        },
      });
      await loadDocuments();
    } catch (err: any) {
      setError(err.message || 'Failed to update issue');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleOpenPreview(doc: ApplicationDocumentItem) {
    setError(null);
    try {
      const signed = await apiRequest<{ url: string }>(`/api/documents/${doc.id}/download-url`);
      setPreviewDoc({
        filename: doc.originalFilename,
        mimeType: doc.mimeType,
        url: signed.url,
      });
    } catch (err: any) {
      setError(err.message || 'Unable to generate signed preview URL');
    }
  }

  async function handleDeleteDoc(docId: string) {
    setBusyAction(true);
    setError(null);
    try {
      await apiRequest(`/api/documents/${docId}`, { method: 'DELETE' });
      if (activeDocId === docId) setActiveDocId(null);
      setNotice('Document removed and verification report refreshed.');
      await loadDocuments();
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to delete document');
    } finally {
      setBusyAction(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500 dark:text-slate-400">
        Loading document checklist, OCR extractions, and consistency verification report...
      </div>
    );
  }

  const openIssues = issues.filter((i) => i.status === 'OPEN');

  return (
    <div className="space-y-6">
      {/* Verification Guardrail Notice */}
      <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-blue-700 dark:text-blue-400" />
        <div>
          <strong>Verification Boundary:</strong> Automated OCR and AI normalization extract structured fields and check cross-document consistency only. They cannot certify legal document authenticity from a scan. Human confirmation and officer inspection remain mandatory.
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-lg border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {/* 5-Layer Verification Summary */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold">
              Multi-Layer Document Verification Summary
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Separates file formatting, OCR extraction, cross-document alignment, external identity verification, and manual officer sign-off.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunVerification}
            disabled={busyAction}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Run Consistency Check
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">1. Formatting & Scan</div>
            <div className={`text-sm font-semibold ${statusSemanticTone(verification?.formatting_status || 'PENDING')}`}>
              {verification?.formatting_status || 'PENDING'}
            </div>
          </div>
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">2. Field Extraction</div>
            <div className={`text-sm font-semibold ${statusSemanticTone(verification?.extraction_status || 'PENDING')}`}>
              {verification?.extraction_status || 'PENDING'}
            </div>
          </div>
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">3. Cross-Doc Consistency</div>
            <div className={`text-sm font-semibold ${statusSemanticTone(verification?.consistency_status || 'PENDING')}`}>
              {verification?.consistency_status || 'PENDING'}
            </div>
          </div>
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">4. External Identity</div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {verification?.external_identity_status || 'NOT_CONNECTED'}
            </div>
          </div>
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">5. Officer Review</div>
            <div className={`text-sm font-semibold ${statusSemanticTone(verification?.manual_officer_status || 'PENDING_REVIEW')}`}>
              {verification?.manual_officer_status || 'PENDING_REVIEW'}
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Checklist + Upload */}
        <div className="lg:col-span-5 space-y-6">
          {/* Dynamic Checklist */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold">Route Document Checklist</h2>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {requirements.filter((r) => ['UPLOADED', 'VERIFIED'].includes(r.status)).length}/
                {requirements.length} ready
              </span>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {requirements.map((reqItem) => (
                <div key={reqItem.id} className="py-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {reqItem.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {reqItem.is_mandatory ? 'Mandatory' : 'Optional'} ·{' '}
                        {DOCUMENT_TYPE_LABELS[reqItem.document_type] || reqItem.document_type}
                      </div>
                    </div>
                    <span className={`text-xs font-semibold shrink-0 ${statusSemanticTone(reqItem.status)}`}>
                      {reqItem.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{reqItem.description}</p>
                  <button
                    type="button"
                    onClick={() => handleSelectRequirement(reqItem)}
                    className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Target upload slot
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Secure File Upload */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="font-display text-base font-semibold">Upload Supporting Document</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Checklist Slot
                </label>
                <select
                  value={selectedReqCode}
                  onChange={(e) => {
                    setSelectedReqCode(e.target.value);
                    const found = requirements.find((r) => r.requirement_code === e.target.value);
                    if (found) setDocumentType(found.document_type);
                  }}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="">General / Unmapped Document</option>
                  {requirements.map((r) => (
                    <option key={r.id} value={r.requirement_code}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Document Type
                </label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Document Expiry Date (Optional — auto-detected from OCR when present)
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void uploadFile(file);
              }}
              className={`border-2 border-dashed rounded-xl p-6 text-center space-y-2 transition-colors ${
                dragOver
                  ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-slate-300 dark:border-slate-700'
              }`}
            >
              <UploadCloud className="w-6 h-6 mx-auto text-slate-400" />
              <div className="text-xs font-medium">
                {uploading ? 'Uploading, scanning, and running OCR...' : 'Drop a document here or choose a file'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Accepted: PDF, JPG, PNG, DOCX · Max 10 MB · Stored privately via signed access
              </div>
              <label className="inline-block mt-1 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer">
                {uploading ? 'Processing...' : 'Select File'}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadFile(file);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </section>
        </div>

        {/* Right: Uploaded Documents & Consistency Issues */}
        <div className="lg:col-span-7 space-y-6">
          {/* Uploaded Files Table */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold">
                Uploaded Document Versions ({documents.length})
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Click Inspect to edit extracted fields or approve
              </span>
            </div>

            {documents.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No documents uploaded for this case yet. Use the upload box to add passport or supporting files.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {documents.map((doc) => {
                  const selected = doc.id === activeDocId;
                  return (
                    <div
                      key={doc.id}
                      className={`p-4 space-y-2 ${
                        selected ? 'bg-slate-50 dark:bg-slate-800/40' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-xs font-semibold truncate max-w-[260px]">
                              {doc.originalFilename}
                            </span>
                            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              v{doc.version} · {formatBytes(doc.byteSize)}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Declared: {DOCUMENT_TYPE_LABELS[doc.documentType] || doc.documentType}
                            {doc.extraction
                              ? ` · Detected: ${doc.extraction.detectedDocumentType} · OCR Confidence: ${(
                                  doc.extraction.confidenceScore * 100
                                ).toFixed(0)}%`
                              : ''}
                          </div>
                          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            Scan:{' '}
                            <span className={statusSemanticTone(doc.malwareScanStatus)}>
                              {doc.malwareScanStatus}
                            </span>{' '}
                            · Review:{' '}
                            <span className={statusSemanticTone(doc.reviewStatus)}>
                              {doc.reviewStatus}
                            </span>
                            {doc.expiryDate ? ` · Expiry: ${doc.expiryDate}` : ''}
                            {doc.extraction?.isConfirmed ? ' · Fields Confirmed' : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {doc.malwareScanStatus !== 'QUARANTINED' && (
                            <button
                              type="button"
                              onClick={() => handleOpenPreview(doc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Preview
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setActiveDocId(selected ? null : doc.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                          >
                            <FileSearch className="w-3.5 h-3.5" />
                            {selected ? 'Close Workbench' : 'Inspect / Verify'}
                          </button>
                          {(isStaff || doc.reviewStatus !== 'VERIFIED') && (
                            <button
                              type="button"
                              onClick={() => handleDeleteDoc(doc.id)}
                              disabled={busyAction}
                              aria-label={`Delete ${doc.originalFilename}`}
                              className="p-1.5 text-slate-500 hover:text-red-700 dark:hover:text-red-400 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {doc.reviewNotes && (
                        <div className="text-xs text-slate-600 dark:text-slate-300 pt-1">
                          Officer note ({doc.reviewedByName || 'Staff'}): {doc.reviewNotes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Active Document OCR & Officer Review Workbench */}
          {activeDoc && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold">
                    Extraction & Verification Workbench: {activeDoc.originalFilename}
                  </h3>
                  {activeDoc.extraction && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      OCR: {activeDoc.extraction.ocrProvider} · Normalizer: {activeDoc.extraction.aiProvider} ({activeDoc.extraction.modelName}) · Confidence:{' '}
                      {(activeDoc.extraction.confidenceScore * 100).toFixed(0)}%
                    </p>
                  )}
                </div>
                {activeDoc.malwareScanStatus !== 'QUARANTINED' && (
                  <button
                    type="button"
                    onClick={() => handleRerunExtraction(activeDoc.id)}
                    disabled={busyAction}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Re-run OCR
                  </button>
                )}
              </div>

              {activeDoc.extraction ? (
                <>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                    {activeDoc.extraction.aiDisclaimer}
                    {activeDoc.extraction.extracted?.readabilityNotes && (
                      <div className="mt-1 text-slate-500 dark:text-slate-400">
                        Readability: {activeDoc.extraction.extracted.readabilityNotes}
                      </div>
                    )}
                  </div>

                  {/* Evidence Snippets */}
                  {activeDoc.extraction.extracted?.evidenceSnippets &&
                    activeDoc.extraction.extracted.evidenceSnippets.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                          OCR Evidence Snippets
                        </div>
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono space-y-0.5 max-h-28 overflow-y-auto">
                          {activeDoc.extraction.extracted.evidenceSnippets.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Raw OCR Text (Immutable Reference) */}
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Raw OCR Output (Preserved Separately from Manual Corrections)
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {activeDoc.extraction.rawOcrText || '(Empty OCR output)'}
                    </pre>
                  </div>

                  {/* Editable Structured Fields */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold">
                        Structured Fields (Editable for Manual Correction)
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {activeDoc.extraction.isConfirmed
                          ? `Confirmed on ${formatShortDate(activeDoc.extraction.confirmedAt)}`
                          : 'Unconfirmed — review required'}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {EDITABLE_FIELD_KEYS.map((f) => (
                        <div key={f.key} className="space-y-1">
                          <label className="block text-xs text-slate-600 dark:text-slate-400">
                            {f.label}
                          </label>
                          <input
                            type="text"
                            value={editFields[f.key] || ''}
                            onChange={(e) =>
                              setEditFields((prev) => ({ ...prev, [f.key]: e.target.value }))
                            }
                            placeholder={f.placeholder || 'Not detected'}
                            className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSaveExtraction(false)}
                        disabled={busyAction}
                        className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Save Manual Corrections
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveExtraction(true)}
                        disabled={busyAction}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Confirm Extracted Fields
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No OCR extraction data available (file may be quarantined or awaiting processing).
                </p>
              )}

              {/* Staff Officer Approval Controls */}
              {isStaff && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="text-xs font-semibold">
                    Verification Officer / Consultant Decision
                  </div>
                  <textarea
                    rows={2}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Officer verification notes (required when requesting correction or rejecting)..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleReviewDocument('VERIFIED')}
                      disabled={busyAction || activeDoc.malwareScanStatus === 'QUARANTINED'}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50 cursor-pointer"
                    >
                      <FileCheck2 className="w-3.5 h-3.5" />
                      Approve Document (Verified)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewDocument('NEEDS_CORRECTION')}
                      disabled={busyAction}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-amber-900 dark:text-amber-200 border border-amber-400 dark:border-amber-700 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 cursor-pointer"
                    >
                      Request Correction
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewDocument('REJECTED')}
                      disabled={busyAction}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-800 dark:text-red-300 border border-red-300 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                    >
                      Reject Document
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Cross-Document & Missing Document Issues */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 className="font-display text-base font-semibold">
                  Consistency & Validation Findings ({openIssues.length} open)
                </h2>
              </div>
            </div>

            {issues.length === 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                No missing documents, readability warnings, or cross-document mismatches detected.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {issues.map((iss) => (
                  <div key={iss.id} className="py-3 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold">
                        <span className={statusSemanticTone(iss.severity)}>{iss.severity}</span> ·{' '}
                        {iss.issue_type}
                        {iss.source_filename ? ` (${iss.source_filename})` : ''}
                      </div>
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {iss.verification_layer} · {iss.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300">{iss.explanation}</p>
                    <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                      Evidence: {iss.evidence}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      Suggested Action: {iss.suggested_correction}
                    </div>
                    {isStaff && iss.status === 'OPEN' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleIssueAction(iss.id, 'RESOLVED')}
                          disabled={busyAction}
                          className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          Mark Resolved
                        </button>
                        <button
                          type="button"
                          onClick={() => handleIssueAction(iss.id, 'OVERRIDDEN')}
                          disabled={busyAction}
                          className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          Override with Note
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* BullMQ-Compatible Jobs Table */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="font-display text-sm font-semibold">
              Background Processing Jobs ({jobs.length})
            </h2>
            {jobs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No background document processing jobs recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-4 font-medium">Job</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Attempts</th>
                      <th className="py-2 font-medium text-right">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {jobs.slice(0, 8).map((job) => (
                      <tr key={job.id}>
                        <td className="py-2 pr-4 font-mono">{job.job_name}</td>
                        <td className={`py-2 pr-4 font-medium ${statusSemanticTone(job.status)}`}>
                          {job.status}
                        </td>
                        <td className="py-2 pr-4 font-mono tabular-nums">{job.attempts}</td>
                        <td className="py-2 font-mono tabular-nums text-right text-slate-500">
                          {formatShortDate(job.completed_at || job.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Signed Private Document Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="text-xs font-semibold truncate">{previewDoc.filename}</div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`${previewDoc.url}&download=1`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-950 p-4 flex items-center justify-center">
              {previewDoc.mimeType.startsWith('image/') ? (
                <img
                  src={previewDoc.url}
                  alt={previewDoc.filename}
                  className="max-w-full max-h-[68vh] object-contain rounded"
                />
              ) : previewDoc.mimeType === 'application/pdf' ? (
                <iframe
                  title={previewDoc.filename}
                  src={previewDoc.url}
                  className="w-full h-[68vh] rounded border border-slate-200 dark:border-slate-800 bg-white"
                />
              ) : (
                <div className="text-center space-y-2 p-8">
                  <ShieldAlert className="w-6 h-6 mx-auto text-slate-500" />
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Inline browser preview is unavailable for {previewDoc.mimeType}. Use the signed Download button above.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
