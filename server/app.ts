import express from 'express';
import type { AppDatabase } from './db.ts';
import { attachAuth } from './middleware.ts';
import { createApplicantsRouter } from './routes/applicants.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createCasesRouter } from './routes/cases.ts';
import { createDocumentsRouter } from './routes/documents.ts';
import { createFormsRouter } from './routes/forms.ts';
import { createOrganizationsRouter } from './routes/organizations.ts';
import { createWorkflowTrackingRouter } from './routes/workflowTracking.ts';

export function createApiApp(db: AppDatabase): express.Express {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use(attachAuth(db));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      phase: 'Phase 5',
      modules: {
        authAndMfa: true,
        multiTenantOrganizations: true,
        applicantProfilesAndConsent: true,
        visaCaseManagement: true,
        ruleEngineCatalog: 'DEMO_ROUTES_ONLY',
        documentCollection: true,
        aiExtractionAndVerification: true,
        dynamicFormsAndHandoff: true,
        notificationsAndTracking: true,
      },
    });
  });

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api', createOrganizationsRouter(db));
  app.use('/api', createApplicantsRouter(db));
  app.use('/api', createCasesRouter(db));
  app.use('/api', createDocumentsRouter(db));
  app.use('/api', createFormsRouter(db));
  app.use('/api', createWorkflowTrackingRouter(db));

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return app;
}
