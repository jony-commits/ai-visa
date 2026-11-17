import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileCheck2, RefreshCw, Search } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  DOCUMENT_TYPE_LABELS,
  formatShortDate,
  statusSemanticTone,
  VerificationIssueItem,
  VerificationQueueDocument,
} from '../types';

interface VerificationQueueViewProps {
  onInspectCaseDocuments: (caseId: string) => void;
}

export const VerificationQueueView: React.FC<VerificationQueueViewProps> = ({
  onInspectCaseDocuments,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<VerificationQueueDocument[]>([]);
  const [openIssues, setOpenIssues] = useState<
    Array<
      VerificationIssueItem & {
        reference_number: string;
        applicant_name: string;
      }
    >
  >([]);

  const [search, setSearch] = useState('');
  const [reviewFilter, setReviewFilter] = useState('ALL');
  const [scanFilter, setScanFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  async function loadQueue() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        pendingDocuments: VerificationQueueDocument[];
        openIssues: Array<
          VerificationIssueItem & {
            reference_number: string;
            applicant_name: string;
          }
        >;
      }>('/api/verification-queue');
      setDocuments(res.pendingDocuments);
      setOpenIssues(res.openIssues);
    } catch (err: any) {
      setError(err.message || 'Failed to load verification queue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  const awaitingOfficerCount = documents.filter((d) =>
    ['PENDING', 'EXTRACTED', 'NEEDS_CORRECTION'].includes(d.review_status),
  ).length;
  const quarantinedCount = documents.filter((d) => d.malware_scan_status === 'QUARANTINED').length;

  const filteredDocuments = documents.filter((doc) => {
    if (reviewFilter === 'AWAITING_REVIEW') {
      if (!['PENDING', 'EXTRACTED', 'NEEDS_CORRECTION'].includes(doc.review_status)) return false;
    } else if (reviewFilter !== 'ALL' && doc.review_status !== reviewFilter) {
      return false;
    }
    if (scanFilter !== 'ALL' && doc.malware_scan_status !== scanFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        doc.reference_number.toLowerCase().includes(q) ||
        doc.applicant_name.toLowerCase().includes(q) ||
        doc.original_filename.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredIssues = openIssues.filter((iss) => {
    if (severityFilter !== 'ALL' && iss.severity !== severityFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        iss.reference_number.toLowerCase().includes(q) ||
        iss.applicant_name.toLowerCase().includes(q) ||
        iss.issue_type.toLowerCase().includes(q) ||
        iss.explanation.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Document Verification Queue
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Review OCR extractions, resolve cross-document discrepancies, and approve documents for your agency.
          </p>
        </div>
        <button
          type="button"
          onClick={loadQueue}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Queue
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 flex flex-wrap items-center justify-between gap-3 text-xs text-red-800 dark:text-red-300"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={loadQueue}
            className="px-3 py-1 font-medium border border-red-400 dark:border-red-700 rounded-lg cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Queue Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Uploaded Documents</div>
          <div className="font-display text-2xl font-bold font-mono tabular-nums">
            {documents.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Scoped to current tenant</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Awaiting Officer Review</div>
          <div className="font-display text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {awaitingOfficerCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Pending human sign-off</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Open Consistency Issues</div>
          <div className="font-display text-2xl font-bold font-mono tabular-nums text-red-700 dark:text-red-400">
            {openIssues.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Cross-doc & missing checks</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Quarantined Files</div>
          <div className="font-display text-2xl font-bold font-mono tabular-nums">
            {quarantinedCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Blocked from download</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by reference, applicant, filename..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
        </div>
        <select
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          <option value="ALL">All Officer Statuses</option>
          <option value="AWAITING_REVIEW">Awaiting Review</option>
          <option value="EXTRACTED">Extracted</option>
          <option value="NEEDS_CORRECTION">Needs Correction</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select
          value={scanFilter}
          onChange={(e) => setScanFilter(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          <option value="ALL">All Scan States</option>
          <option value="CLEAN">Clean</option>
          <option value="QUARANTINED">Quarantined</option>
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          <option value="ALL">All Issue Severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="WARNING">Warning</option>
          <option value="INFO">Info</option>
        </select>
      </div>

      {/* Document Review Queue Table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-slate-500" />
            <h2 className="font-display text-base font-semibold">Tenant Document Submissions</h2>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {filteredDocuments.length} of {documents.length} shown
          </span>
        </div>

        {loading ? (
          <div className="p-6 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {documents.length === 0
              ? 'No documents uploaded across active cases yet. Open any visa case to upload and inspect documents.'
              : 'No documents match your active filter criteria.'}
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-5 font-medium">Case Ref</th>
                <th className="py-3 px-5 font-medium">Applicant</th>
                <th className="py-3 px-5 font-medium">Document</th>
                <th className="py-3 px-5 font-medium">Confidence</th>
                <th className="py-3 px-5 font-medium">Scan Status</th>
                <th className="py-3 px-5 font-medium">Officer Status</th>
                <th className="py-3 px-5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredDocuments.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-5 font-mono tabular-nums font-medium text-blue-700 dark:text-blue-400">
                    {doc.reference_number}
                  </td>
                  <td className="py-3 px-5 font-medium">{doc.applicant_name}</td>
                  <td className="py-3 px-5">
                    <div className="font-medium">{doc.original_filename}</div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type} · v{doc.version}
                    </div>
                  </td>
                  <td className="py-3 px-5 font-mono tabular-nums">
                    {doc.confidence_score !== null && doc.confidence_score !== undefined
                      ? `${(doc.confidence_score * 100).toFixed(0)}%${doc.is_confirmed ? ' (Confirmed)' : ''}`
                      : '—'}
                  </td>
                  <td className={`py-3 px-5 font-medium ${statusSemanticTone(doc.malware_scan_status)}`}>
                    {doc.malware_scan_status}
                  </td>
                  <td className={`py-3 px-5 font-medium ${statusSemanticTone(doc.review_status)}`}>
                    {doc.review_status}
                  </td>
                  <td className="py-3 px-5 text-right">
                    <button
                      type="button"
                      onClick={() => onInspectCaseDocuments(doc.application_id)}
                      className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Open Workbench
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Open Cross-Document Consistency Issues */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <h2 className="font-display text-base font-semibold">
            Open Validation & Cross-Document Discrepancies ({filteredIssues.length})
          </h2>
        </div>

        {filteredIssues.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No open validation issues match the current filters.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredIssues.map((iss) => (
              <div key={iss.id} className="py-3 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold">
                    <span className={statusSemanticTone(iss.severity)}>{iss.severity}</span> ·{' '}
                    <span className="font-mono">{iss.reference_number}</span> ({iss.applicant_name}) ·{' '}
                    {iss.issue_type}
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300">{iss.explanation}</p>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {iss.evidence} · {formatShortDate(iss.created_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onInspectCaseDocuments(iss.application_id)}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
                >
                  Inspect Case
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
