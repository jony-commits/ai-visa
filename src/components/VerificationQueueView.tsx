import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileCheck2, RefreshCw } from 'lucide-react';
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
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Queue
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-300">
          {error}
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

      {/* Document Review Queue Table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-slate-500" />
          <h2 className="font-display text-base font-semibold">Tenant Document Submissions</h2>
        </div>

        {loading ? (
          <div className="p-8 text-xs text-slate-500 dark:text-slate-400">
            Loading verification queue...
          </div>
        ) : documents.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No documents uploaded across active cases yet. Open any visa case to upload and inspect documents.
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
              {documents.map((doc) => (
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
            Open Validation & Cross-Document Discrepancies ({openIssues.length})
          </h2>
        </div>

        {openIssues.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No open validation issues in the current tenant.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {openIssues.map((iss) => (
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
