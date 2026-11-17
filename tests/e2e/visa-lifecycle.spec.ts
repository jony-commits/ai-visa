import { expect, Page, test } from '@playwright/test';

async function signInDemoUser(page: Page, fullName: string) {
  await page.goto('/');
  await expect(page.getByText('Demonstration Accounts')).toBeVisible();
  const row = page.locator('div.py-2\\.5').filter({ hasText: fullName }).first();
  await row.getByRole('button', { name: 'Sign In' }).click();
}

async function signInWithCredentials(page: Page, email: string, password: string) {
  await page.goto('/');
  await expect(page.getByText('Sign in to your workspace')).toBeVisible();
  await page.getByPlaceholder('name@agency.com').fill(email);
  await page.getByPlaceholder('Enter password').fill(password);
  await page.locator('form button[type="submit"]').click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByText('Sign in to your workspace')).toBeVisible();
}

function buildPassportPdfBuffer(): Buffer {
  const payload = [
    '%PDF-1.4',
    'PASSPORT',
    'Full Name: Priya Nair',
    'Date of Birth: 1995-08-21',
    'Nationality: IN',
    'Passport No: P8841920',
    'Issuing Country: IN',
    'Issue Date: 2023-01-10',
    'Expiry Date: 2033-01-09',
    '%%EOF',
  ].join('\n');
  return Buffer.from(payload, 'utf8');
}

test.describe.serial('Meridian Visa End-to-End Lifecycle & Role Dashboards', () => {
  let createdDeCaseRef = '';

  test('1. Applicant completes onboarding, recovers from dashboard API error, creates case & uploads passport', async ({
    page,
  }) => {
    await signInWithCredentials(page, 'applicant2@apexmobility.demo', 'MeridianDemo!2026');
    await expect(
      page.getByRole('heading', { name: 'Applicant Immigration Portal' }),
    ).toBeVisible();

    // Verify retryable dashboard error state when analytics endpoint returns 500
    let failOnce = true;
    await page.route('**/api/analytics/overview*', async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Simulated analytics outage for retry verification' }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'Refresh Metrics' }).click();
    await expect(page.getByRole('alert')).toContainText('Simulated analytics outage');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText('My Applications', { exact: true })).toBeVisible();

    // Applicant onboarding banner should prompt completion
    await expect(page.getByText('Complete your applicant onboarding profile')).toBeVisible();
    await page.getByRole('button', { name: 'Start Onboarding' }).click();
    await expect(
      page.getByRole('heading', { name: 'Applicant Onboarding & Profile' }),
    ).toBeVisible();

    // Step 1: Identity & Residence
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Date of Birth' }) })
      .locator('input')
      .fill('1995-08-21');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Phone Number' }) })
      .locator('input')
      .fill('+1-415-555-0199');

    // Step 2: Passport Record (Encrypted at rest)
    await page.getByRole('button', { name: '02. Passport Record' }).click();
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Passport Number' }) })
      .locator('input')
      .fill('P8841920');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Issue Date' }) })
      .locator('input')
      .fill('2023-01-10');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Expiry Date' }) })
      .locator('input')
      .fill('2033-01-09');

    // Step 3: Travel & Dependents
    await page.getByRole('button', { name: '03. Travel & Dependents' }).click();
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Travel Destination' }) })
      .locator('select')
      .selectOption('DE');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Visa Category' }) })
      .locator('select')
      .selectOption('TOURIST');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Intended Arrival' }) })
      .locator('input')
      .fill('2027-07-10');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Intended Departure' }) })
      .locator('input')
      .fill('2027-07-22');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Purpose of Travel' }) })
      .locator('textarea')
      .fill('Cultural tourism and museum visits across Bavaria');

    // Step 4: Consents & Save
    await page.getByRole('button', { name: '04. Consents & Review' }).click();
    await page.getByText('External AI Extraction & Prefill (Optional)').click();
    await page.getByRole('button', { name: 'Save Onboarding Profile' }).click();
    await expect(
      page.getByText('Onboarding profile, encrypted passport record, and consent preferences saved.'),
    ).toBeVisible();

    // Confirm passport is returned masked (not plaintext)
    await page.getByRole('button', { name: '02. Passport Record' }).click();
    await expect(page.getByText('Stored: ••••1920')).toBeVisible();

    // Create a new DE TOURIST visa case
    await page.getByRole('button', { name: 'New Visa Case' }).click();
    await expect(
      page.getByRole('heading', { name: 'New Visa Application Case' }),
    ).toBeVisible();
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Destination Country' }) })
      .locator('select')
      .selectOption('DE');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Visa Category' }) })
      .locator('select')
      .selectOption('TOURIST');
    await page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: 'Purpose of Travel' }) })
      .locator('input')
      .fill('Museum and heritage itinerary in Munich');
    await page.getByRole('button', { name: 'Create Case' }).click();

    // Open newly created DE TOURIST case
    const deRow = page.locator('tbody tr').filter({ hasText: 'Germany · Tourist' }).first();
    await expect(deRow).toBeVisible();
    createdDeCaseRef = (await deRow.locator('td').first().innerText()).trim();
    expect(createdDeCaseRef).toMatch(/^MRD-\d{4}-/);
    await deRow.click();

    // Upload valid passport PDF to Documents & AI Verification tab
    await page.getByRole('button', { name: 'Documents & AI Verification' }).click();
    await expect(page.getByText('Route Document Checklist')).toBeVisible();

    await page
      .locator('div.space-y-1')
      .filter({ has: page.locator('label', { hasText: 'Checklist Slot' }) })
      .locator('select')
      .selectOption('PASSPORT_BIO_PAGE');

    await page.locator('input[type="file"]').setInputFiles({
      name: 'priya-passport.pdf',
      mimeType: 'application/pdf',
      buffer: buildPassportPdfBuffer(),
    });

    await expect(
      page.getByText('Extraction & Verification Workbench: priya-passport.pdf'),
    ).toBeVisible();
    await expect(page.getByText('Scan: CLEAN')).toBeVisible();

    // Confirm extracted fields
    await page.getByRole('button', { name: 'Confirm Extracted Fields' }).click();
    await expect(
      page.getByText('Extracted fields saved and marked as human-confirmed'),
    ).toBeVisible();

    await signOut(page);
  });

  test('2. Verification Officer reviews queue and approves document; Applicant prefills, signs, and generates handoff', async ({
    page,
  }) => {
    // Officer logs in and approves Priya's passport via Document Verification queue
    await signInDemoUser(page, 'David Okafor');
    await expect(
      page.getByRole('heading', { name: 'Verification & Compliance Workbench' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Document Verification' }).click();
    await expect(
      page.getByRole('heading', { name: 'Document Verification Queue' }),
    ).toBeVisible();

    await page.getByPlaceholder('Filter by reference, applicant, filename...').fill('priya-passport.pdf');
    const queueRow = page.locator('tbody tr').filter({ hasText: 'priya-passport.pdf' }).first();
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole('button', { name: 'Open Workbench' }).click();

    await page.getByRole('button', { name: 'Inspect / Verify' }).first().click();
    await page
      .getByPlaceholder(/Officer verification notes/)
      .fill('Passport bio page legible and matches applicant onboarding record.');
    await page.getByRole('button', { name: 'Approve Document (Verified)' }).click();
    await expect(page.getByText('Officer decision recorded: VERIFIED')).toBeVisible();

    await signOut(page);

    // Applicant signs back in, completes form, approves declaration & records guided handoff
    await signInWithCredentials(page, 'applicant2@apexmobility.demo', 'MeridianDemo!2026');
    await page.getByRole('button', { name: 'Visa Cases' }).click();
    await page.locator('tbody tr').filter({ hasText: createdDeCaseRef }).first().click();

    await page.getByRole('button', { name: 'Dynamic Form & Submission' }).click();
    await expect(
      page.getByText('Germany Short-Stay Visitor (Schengen C)'),
    ).toBeVisible();

    // Prefill verified profile, encrypted passport, and confirmed OCR extraction
    await page.getByRole('button', { name: 'Prefill Verified Data' }).click();
    await expect(page.getByText(/Prefilled \d+ field/)).toBeVisible();
    await expect(page.locator('#form-field-fullLegalName')).toHaveValue('Priya Nair');
    await expect(page.locator('#form-field-passportNumber')).toHaveValue('P8841920');

    // Step 2: Travel & Lodging
    await page.getByRole('button', { name: 'Next Step' }).click();
    await page.locator('#form-field-accommodationType').selectOption('HOTEL');
    await page.locator('#form-field-hotelNameAndBookingRef').fill('Hotel Maximilian Munich — BK9021');
    await page
      .locator('#form-field-purposeSummary')
      .fill('Ten-day cultural tourism itinerary in Munich and Nuremberg museums.');

    // Step 3: Funding, Employment & Home Ties
    await page.getByRole('button', { name: 'Next Step' }).click();
    await page.locator('#form-field-fundingSource').selectOption('SELF_FUNDED');
    await page.locator('#form-field-employmentStatus').selectOption('EMPLOYED');
    await page.locator('#form-field-employerName').fill('Northstar Systems Inc');
    await page.locator('#form-field-monthlyNetIncomeUsd').fill('7200');
    await page
      .locator('#form-field-financialSupportExplanation')
      .fill('Liquid personal checking and savings exceeding 15,000 USD verified on statements.');
    await page
      .locator('#form-field-homeCountryTiesSummary')
      .fill('Full-time engineering role and active residential lease requiring return to San Francisco.');

    await page.getByRole('button', { name: 'Save Step Revision' }).click();
    await expect(page.getByText('Complete & Valid')).toBeVisible();

    // Applicant attestation & final form approval
    await page
      .getByLabel(
        /I confirm that all entries in this form—including prefilled data and any AI draft suggestions/,
      )
      .check();
    await page.getByRole('button', { name: 'Approve Complete Application Form' }).click();
    await expect(
      page.getByText('Applicant declaration approved and locked for submission handoff.'),
    ).toBeVisible();

    // Generate Guided Manual Handoff Package & record external receipt ref
    await page.getByRole('button', { name: 'Generate Guided Manual Handoff Package' }).click();
    await expect(
      page.getByText('Guided submission handoff package generated from applicant-approved form data.'),
    ).toBeVisible();
    await page
      .getByPlaceholder('Enter official confirmation receipt #')
      .fill('VIDEX-DE-2027-5501');
    await page.getByRole('button', { name: 'Record External Filing Receipt' }).click();
    await expect(
      page.getByText('External submission reference "VIDEX-DE-2027-5501" recorded'),
    ).toBeVisible();

    await signOut(page);
  });

  test('3. Consultant updates workflow/appointments/external status; Admin & Super Admin verify dashboards, AI telemetry & Audit filters', async ({
    page,
  }) => {
    // Consultant advances workflow, sets source-attributed external status & books appointment
    await signInDemoUser(page, 'Elena Rostova');
    await expect(
      page.getByRole('heading', { name: 'Consultant Case Operations' }),
    ).toBeVisible();
    await expect(page.getByText('Workflow Stage Bottlenecks')).toBeVisible();

    // Test Cases Kanban + Filters
    await page.getByRole('button', { name: 'Kanban Board' }).click();
    await expect(page.getByRole('heading', { name: 'Intake & Draft' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Document Collection' })).toBeVisible();

    await page.getByPlaceholder('Search reference, applicant, country...').fill(createdDeCaseRef);
    await page.getByRole('button', { name: new RegExp(createdDeCaseRef) }).first().click();

    // Advance stage from APPLICANT_INFO_PENDING -> DOCUMENT_COLLECTION
    await page
      .locator('div.space-y-1')
      .filter({ has: page.locator('label', { hasText: 'Next Valid Stage' }) })
      .locator('select')
      .selectOption('DOCUMENT_COLLECTION');
    await page.getByPlaceholder('Reason for stage change').fill('Applicant onboarding and passport confirmed');
    await page.getByRole('button', { name: 'Advance Stage' }).click();
    await expect(
      page.locator('div.text-base.font-semibold').filter({ hasText: 'Document Collection' }),
    ).toBeVisible();

    // Record source-attributed manual external status (separated from internal stage)
    await page
      .getByPlaceholder('e.g., Biometrics Appointment Booked')
      .fill('Application Logged at Munich VAC');
    await page
      .locator('div.space-y-1')
      .filter({ has: page.locator('label', { hasText: 'Verified Source' }) })
      .locator('select')
      .selectOption('CONSULTANT_MANUAL_UPDATE');
    await page.getByPlaceholder('Optional portal ref').fill('VAC-MUN-9042');
    await page.getByRole('button', { name: 'Save Status' }).click();
    await expect(
      page.locator('div.text-base.font-semibold').filter({ hasText: 'Application Logged at Munich VAC' }),
    ).toBeVisible();
    await expect(page.getByText(/Source: CONSULTANT_MANUAL_UPDATE/).first()).toBeVisible();

    // Tracking & Appointments tab
    await page.getByRole('button', { name: 'Tracking, Appointments & Notifications' }).click();
    await page.getByPlaceholder('VFS Global / Consulate General').fill('VFS Global Munich VAC');
    await page
      .locator('div.space-y-1')
      .filter({ has: page.locator('label', { hasText: /^Date & Time \(UTC\)$/ }) })
      .locator('input')
      .fill('2027-06-20T09:30');
    await page.getByRole('button', { name: 'Schedule Appointment' }).click();
    await expect(page.getByText('BIOMETRICS · VFS Global Munich VAC').first()).toBeVisible();

    await signOut(page);

    // Agency Admin checks Operations Dashboard, AI Telemetry, and Audit Trail filtering
    await signInDemoUser(page, 'Marcus Chen');
    await expect(
      page.getByRole('heading', { name: 'Agency Operations Dashboard' }),
    ).toBeVisible();
    await expect(page.getByText('AI Usage, Token Telemetry & OCR Engines')).toBeVisible();
    await expect(page.getByText('Staff Workload & SLA Capacity')).toBeVisible();

    await page.getByRole('button', { name: 'Security & Audit' }).click();
    await expect(page.getByRole('heading', { name: 'Security & Audit Trail' })).toBeVisible();
    await page.getByPlaceholder('Search actor, action, ID...').fill('GOVERNMENT_STATUS');
    await expect(page.getByText('GOVERNMENT_STATUS_RECORDED').first()).toBeVisible();
    await page.getByRole('button', { name: 'Inspect' }).first().click();
    await expect(page.getByText(/CONSULTANT_MANUAL_UPDATE/).first()).toBeVisible();

    // Agency Admin tests Country Rule Engine Simulator & Dynamic Form Builder
    await page.getByRole('button', { name: 'Rules & Form Builder' }).click();
    await expect(
      page.getByRole('heading', { name: 'Country Visa Rule Engine & Dynamic Form Builder' }),
    ).toBeVisible();
    await page.locator('#sim-country').selectOption('DE');
    await page.locator('#sim-category').selectOption('TOURIST');
    await page.locator('#sim-days').fill('45');
    await page.getByRole('button', { name: 'Evaluate Country Rules' }).click();
    await expect(page.getByText(/Evaluated Requirements/)).toBeVisible();
    await expect(page.getByText('Extended Stay Accommodation & Return Ties Proof')).toBeVisible();

    await page.getByRole('button', { name: 'Dynamic Form Builder' }).click();
    await expect(page.getByText('Dynamic Visa Form Schemas')).toBeVisible();
    await expect(page.getByText('Interactive Schema Preview')).toBeVisible();

    await signOut(page);

    // Super Admin checks Platform Governance vs Active Tenant toggle
    await signInDemoUser(page, 'Claire Vance');
    await expect(
      page.getByRole('heading', { name: 'Platform Super Admin Console' }),
    ).toBeVisible();
    await expect(page.getByText('Cross-Tenant Governance & Health')).toBeVisible();
    await expect(page.getByText('Apex Global Mobility').first()).toBeVisible();
    await expect(page.getByText('Pacific Rim Immigration').first()).toBeVisible();

    await page.getByRole('button', { name: /Active Tenant/ }).click();
    await expect(page.getByText('Tenant-isolated operations for Apex Global Mobility')).toBeVisible();
  });
});
