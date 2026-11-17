import { AppDatabase, newId } from '../db.ts';
import { extractAndPersistDocumentData } from './extraction.ts';
import { scanBufferForMalware, getPrivateObject } from './storage.ts';
import { runCaseVerification } from './verification.ts';

export const QUEUE_DOCUMENT_PROCESSING = 'meridian-document-processing';

export interface BullMQCompatibleJobSpec {
  queueName: string;
  jobName: 'document.scan' | 'document.extract' | 'case.verify-consistency';
  organizationId: string;
  applicationId: string;
  documentId?: string;
  actorUserId?: string;
  attemptsLimit?: number;
}

export async function enqueueAndExecuteJob(
  db: AppDatabase,
  spec: BullMQCompatibleJobSpec,
): Promise<{ jobId: string; status: string; result?: unknown; error?: string }> {
  const jobId = newId('job');
  const bullmqJobId = `${spec.queueName}:${spec.jobName}:${jobId}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO processing_jobs (
      id, organization_id, application_id, document_id, queue_name, job_name,
      bullmq_job_id, status, attempts, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?)
  `).run(
    jobId,
    spec.organizationId,
    spec.applicationId,
    spec.documentId || null,
    spec.queueName,
    spec.jobName,
    bullmqJobId,
    JSON.stringify(spec),
    now,
  );

  // Execute job with deterministic retry policy (mirrors BullMQ worker handler)
  const maxAttempts = spec.attemptsLimit ?? 2;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    db.prepare('UPDATE processing_jobs SET status = ?, attempts = ? WHERE id = ?').run(
      'ACTIVE',
      attempt,
      jobId,
    );

    try {
      let result: unknown = null;

      if (spec.jobName === 'document.scan') {
        if (!spec.documentId) throw new Error('documentId required for scan');
        const doc = db
          .prepare('SELECT storage_key FROM application_documents WHERE id = ? AND organization_id = ?')
          .get(spec.documentId, spec.organizationId) as { storage_key: string } | undefined;
        if (!doc) throw new Error('Document not found');
        const buf = getPrivateObject(doc.storage_key);
        if (!buf) throw new Error('Object missing in storage');
        const scan = scanBufferForMalware(buf);
        const scanStatus = scan.clean ? 'CLEAN' : 'QUARANTINED';
        db.prepare(
          'UPDATE application_documents SET malware_scan_status = ?, updated_at = ? WHERE id = ?',
        ).run(scanStatus, new Date().toISOString(), spec.documentId);
        result = scan;
      } else if (spec.jobName === 'document.extract') {
        if (!spec.documentId) throw new Error('documentId required for extraction');
        result = await extractAndPersistDocumentData(db, {
          documentId: spec.documentId,
          actorUserId: spec.actorUserId,
        });
      } else if (spec.jobName === 'case.verify-consistency') {
        result = runCaseVerification(db, spec.applicationId, spec.organizationId);
      }

      db.prepare(
        'UPDATE processing_jobs SET status = ?, result_json = ?, completed_at = ? WHERE id = ?',
      ).run('COMPLETED', JSON.stringify(result), new Date().toISOString(), jobId);

      return { jobId, status: 'COMPLETED', result };
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  db.prepare(
    'UPDATE processing_jobs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?',
  ).run('FAILED', lastErr?.message || 'Job failed', new Date().toISOString(), jobId);

  return {
    jobId,
    status: 'FAILED',
    error: lastErr?.message || 'Job failed',
  };
}

export async function runDocumentUploadPipeline(
  db: AppDatabase,
  params: {
    organizationId: string;
    applicationId: string;
    documentId: string;
    actorUserId: string;
  },
) {
  const scanJob = await enqueueAndExecuteJob(db, {
    queueName: QUEUE_DOCUMENT_PROCESSING,
    jobName: 'document.scan',
    organizationId: params.organizationId,
    applicationId: params.applicationId,
    documentId: params.documentId,
    actorUserId: params.actorUserId,
  });

  const scanResult = scanJob.result as { clean?: boolean } | undefined;
  if (!scanResult?.clean) {
    const verifyJob = await enqueueAndExecuteJob(db, {
      queueName: QUEUE_DOCUMENT_PROCESSING,
      jobName: 'case.verify-consistency',
      organizationId: params.organizationId,
      applicationId: params.applicationId,
      actorUserId: params.actorUserId,
    });
    return { scanJob, extractJob: null, verifyJob };
  }

  const extractJob = await enqueueAndExecuteJob(db, {
    queueName: QUEUE_DOCUMENT_PROCESSING,
    jobName: 'document.extract',
    organizationId: params.organizationId,
    applicationId: params.applicationId,
    documentId: params.documentId,
    actorUserId: params.actorUserId,
  });

  const verifyJob = await enqueueAndExecuteJob(db, {
    queueName: QUEUE_DOCUMENT_PROCESSING,
    jobName: 'case.verify-consistency',
    organizationId: params.organizationId,
    applicationId: params.applicationId,
    actorUserId: params.actorUserId,
  });

  return { scanJob, extractJob, verifyJob };
}
