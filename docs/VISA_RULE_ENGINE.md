# Visa Rule Engine Architecture — Meridian Visa Platform

## 1. Core Design Principle
Immigration requirements are legal rules, not generative text. The Visa Rule Engine uses deterministic, version-controlled rule definitions authored and approved by authorized staff. AI may assist staff by summarizing an official government URL provided by an administrator, but AI output is never published directly as active policy.

## 2. Rule Evaluation Dimensions
Rules are resolved deterministically based on:
- `destinationCountry` (ISO 3166-1 alpha-2)
- `applicantNationality`
- `residenceCountry`
- `visaCategory` (`TOURIST`, `BUSINESS`, `STUDENT`, `WORK`, `FAMILY`, `TRANSIT`, `OTHER`)
- `purposeOfTravel` & `travelDurationDays`
- `applicationDate` (matched against `effectiveFrom` / `effectiveTo`)

## 3. Version Control & Provenance
Every `VisaRuleVersion` records:
- `version` (semantic or sequential integer)
- `effectiveFrom` / `effectiveTo`
- `officialSourceUrl` and `sourceVerifiedAt`
- `isDemoRule` boolean flag (clearly surfaced in the UI whenever demonstration rules are active)
- `approvalStatus` (`DRAFT` | `IN_REVIEW` | `PUBLISHED` | `ARCHIVED`)
- `approvedByUserId` and `approvedAt`
- `requiredDocuments`: structured list with conditions (e.g., `if employmentStatus === 'EMPLOYED'`, `if stayDays > 30`)
- `formSchema`: JSON Schema definition for dynamic form rendering
- `verifiedFeeInfo`: `{ amount, currency, sourceNote }` (optional, only when verified)
- `appointmentRequired`: boolean + instructions

## 4. Extensible Country Adapter Interface
```ts
export interface CountryRuleAdapter {
  countryCode: string;
  evaluateRequirements(context: ApplicantRuleContext, ruleVersion: VisaRuleVersion): DocumentRequirementSpec[];
  validatePassportValidity(passportExpiry: Date, intendedReturn: Date, ruleVersion: VisaRuleVersion): RuleCheckResult;
}
```

## 5. Initial Demonstration Routes
Phase 1 seeds three clearly labeled **Demonstration Routes** (`isDemoRule = true`) to enable end-to-end case creation and testing without misrepresenting sample data as live government policy:
1. **DE-SCHENGEN-TOURIST (Demo v1.0)** — Germany Short-Stay Visitor (Demonstration Rule)
2. **UK-STANDARD-VISITOR (Demo v1.0)** — United Kingdom Standard Visitor (Demonstration Rule)
3. **CA-STUDY-PERMIT (Demo v1.0)** — Canada Study Permit (Demonstration Rule)
