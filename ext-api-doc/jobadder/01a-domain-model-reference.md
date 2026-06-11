---
api_name: 'JobAdder'
api_slug: 'jobadder'
generated_from: 'Official OpenAPI spec (api.jobadder.com/v2/openapi.json, fetched live 2026-06-10) + community spec mirror'
generated_date: '2026-06-10'
source_phases: ['Domain Model & Behavior']
---

# JobAdder -- Domain Model Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> Field tables are mined from the **official OpenAPI spec** (fetched 2026-06-10) — tagged [DOCS].
> [SPEC-community] marks items only seen in the community mirror (github.com/vitaliymashkov/jobadder-api);
> [UNVERIFIED] marks inference. GET a real record and mirror what comes back before writing.

## The Recruitment Workflow Hierarchy

JobAdder models the agency-recruitment funnel. Everything hangs off **Jobs** (job orders) and
**Candidates**, joined by **Applications**, ending in **Placements** [DOCS]:

```
Company (client business)
  ├── Contacts (client-side people; hiringManager flag)
  ├── Addresses (uuid-keyed; workplace addresses for jobs)
  └── Jobs (JobOrder — the vacancy/order to fill)
        ├── Job Ads (adId — the advertisement posted to boards)   ← separate entity!
        ├── Applications (candidate ↔ job; status workflow lives here)
        │     └── Interviews / Reviews / Videos / Attachments
        └── Placements (the hire; Permanent/Contract/Temporary)
Candidate (job seeker)
  ├── Applications / Submissions / Floats
  ├── Attachments (Resume, CoverLetter, ...) / Photo / Videos
  ├── Skills, Availability, Employment history, Education
  └── Notes (also attachable to every other entity)
Users (recruiters — read-only via API), Folders, Requisitions, Opportunities
```

Consequences for the agent:

- A "job" in conversation = **JobOrder** (`/jobs`, `jobId`). A "job ad" = `/jobads` (`adId`) — the
  posting derived from a job. Don't mix them up [DOCS].
- The **Application** is the workflow object — moving a candidate through stages means updating the
  application's status, not the candidate or job [DOCS].
- **Placements are created in the JobAdder UI** when an application is placed; API is read/update only [DOCS].
- Notes are polymorphic — one note can link to multiple jobs/candidates/applications/etc. [DOCS].

## ID Semantics

- Core entity ids are **integers**: `jobId`, `candidateId`, `companyId`, `contactId`, `placementId`,
  `userId` (int32); `applicationId` is **int64** [DOCS].
- UUIDs: `noteId`, `addressId` (company addresses), `webhookId`, partner `actionId` [DOCS].
- Field casing is camelCase throughout (`jobTitle`, `statusId`, `createdAt`, `ownerUserId`) [DOCS].
- Timestamps: ISO 8601 date-time, UTC assumed (`2026-01-01T09:00:00Z`); plain dates as `yyyy-MM-dd`
  (`startDate`, `endDate`) [DOCS].

## Shared Sub-Objects

These nested models recur across entities [DOCS]:

| Model            | Fields                                                                |
| ---------------- | --------------------------------------------------------------------- |
| `StatusModel`    | `statusId` (int), `name`, `active` (bool), `default` (bool)            |
| `UserNameModel`  | `userId`, `firstName`, `lastName`, `position`, `email`, `phone`, `mobile`, `inactive`, `deleted` |
| `AddressModel`   | `street` (array of strings!), `city`, `state`, `postalCode`, `country`, `countryCode` |
| `CompanyAddressModel` | `addressId` (uuid), `name`, `street[]`, `city`, `state`, `postalCode`, `country`, `countryCode`, `phone`, `fax`, `url` |
| `CustomFieldValueModel` | `fieldId`, `name`, `type` (`Text\|List\|Date\|Lookup`), `value` |
| Audit fields     | `createdBy`/`createdAt`, `updatedBy`/`updatedAt` (+ `closedBy`/`closedAt` on jobs) on every core entity |

`street` being an **array** is an easy write-bug — `{"street": ["1 Queen St"], "city": "Auckland", ...}` [DOCS].

## Read Shapes: Representation vs Summary

Every core entity has two read shapes [DOCS]:

- **`{Entity}Representation`** — full object, returned by single GETs (`/jobs/{jobId}`) and creates (201).
- **`{Entity}SummaryModel`** — trimmed version inside list `items[]` and when nested in other
  entities (an application embeds `CandidateSummaryModel`, not the full candidate).

Summaries keep ids, names, status, and audit fields but drop deep nests (employment history,
education, custom fields, statistics). **If a field you expect is missing from a list result,
GET the single record** — don't assume the account lacks the data.

## Custom Fields

Each core entity has its own custom-field definitions: `GET /{entity}/fields/custom` →
`CustomFieldModel`: `fieldId`, `name`, `type` (`Text|List|Date|Lookup`), `mandatory`, `maxLength`,
`multiLine`, `multiSelect`, `values[]` (allowed values for List fields) [DOCS]. On reads, values
arrive as `custom: [{fieldId, name, type, value}]`; on writes you send `custom: [{fieldId, value}]`
[DOCS]. Respect `mandatory`, `maxLength`, and `values` or expect a 422.

## Job (JobOrder) — `/jobs`, id `jobId`

`JobOrderRepresentation` [DOCS]:

| Field              | Type                | Notes                                          |
| ------------------ | ------------------- | ---------------------------------------------- |
| `jobId`            | int (required)      |                                                |
| `jobTitle`         | string              | The only required field on create              |
| `company`          | CompanyNameModel    | `{companyId, name}` nested on read             |
| `contact`          | ContactNameModel    | Client-side hiring contact                     |
| `status`           | StatusModel         | Account-specific; resolve via `/jobs/lists/status` |
| `source`           | string              | Lead source; values via `/jobs/lists/source`   |
| `jobDescription`   | string              |                                                |
| `numberOfJobs`     | int                 | Openings count                                 |
| `workplaceAddress` | CompanyAddressModel |                                                |
| `category`         | JobOrderCategoryModel | `{categoryId, name, subCategory}` — `/categories` |
| `location`         | JobOrderLocationModel | `{locationId, name, area}` — `/locations`    |
| `start`            | JobOrderStartModel  | `{immediate, relative, date}`                  |
| `endDate`          | date                | [DOCS — official spec only]                    |
| `duration`         | DurationModel       | `{period, unit: Hour\|Day\|Week\|Month}`       |
| `workType`         | WorkTypeModel       | `{workTypeId, name, ratePer}` — `/worktypes`   |
| `workShift` / `jobType` | object/string  | [DOCS — official spec only; shapes unmined]    |
| `salary`           | JobOrderSalaryRangeModel | `{ratePer: Hour..Year, rateLow, rateHigh, currency, timePerWeek}` |
| `fee`              | JobOrderFeeModel    |                                                |
| `skillTags`        | JobOrderSkillTags   |                                                |
| `custom`           | CustomFieldValueModel[] | Defs via `/jobs/fields/custom`             |
| `owner` / `recruiters` | UserNameModel / [] | Job owner + working recruiters             |
| `requisitionId`    | int                 | Link to originating requisition [DOCS — official only] |
| `userFavourite`    | bool                |                                                |
| `statistics`       | object              | Opt-in via `fields=statistics`                 |
| audit fields       |                     | + `closedBy`/`closedAt`                        |

List shape: `{items: JobOrderSummaryModel[], totalCount, links}` — summaries drop the deep nests [DOCS].

## Candidate — `/candidates`, id `candidateId`

`CandidateRepresentation` [DOCS]:

| Field            | Type            | Notes                                              |
| ---------------- | --------------- | --------------------------------------------------- |
| `candidateId`    | int (required)  |                                                     |
| `firstName` / `lastName` | string  |                                                     |
| `email`          | string          | Dedupe key on create (409 on duplicate)             |
| `phone` / `mobile` | string        | + `mobileNormalized` read-only [DOCS — official only] |
| `contactMethod`  | string          |                                                     |
| `salutation`     | string          | Values via `/candidates/lists/salutation`           |
| `address`        | AddressModel    | `street` is an array                                |
| `status`         | StatusModel     | `/candidates/lists/status`                          |
| `rating`         | string          | Values via `/candidates/lists/rating`               |
| `source`         | string          | `/candidates/lists/source`                          |
| `seeking`        | enum            | `Yes` \| `Maybe` \| `No`                            |
| `otherEmail`     | string[]        |                                                     |
| `social`         | object          | Free-form social handles                            |
| `summary`        | string          |                                                     |
| `dateOfBirth`    | date            | [DOCS — official only]                              |
| `emergencyContact` / `emergencyPhone` | string | [DOCS — official only]            |
| `unsubscribed`   | bool            | Marketing opt-out [DOCS — official only]            |
| `employment`     | CandidateEmploymentModel | `{current, ideal, history[{employer, position, start, end, description}]}` |
| `availability`   | CandidateStartModel | `{immediate, relative, date}`                   |
| `education`      | CandidateEducationModel[] |                                           |
| `skillTags`      | string[]        |                                                     |
| `custom`         | CustomFieldValueModel[] | `/candidates/fields/custom`                 |
| `recruiters`     | UserNameModel[] |                                                     |
| `statistics`     | object          | Opt-in via `fields=`                                |
| audit fields     |                 |                                                     |

Employment sub-shapes [DOCS]: `employment.current` = `{employer, position, workType, salary}`;
`employment.ideal` = `{position, workType, salary (range), other[]}`; `employment.history[]` =
`{employer, position, start, end, description}`. `availability` / `start` models share
`{immediate: bool, relative: {period, unit}, date}` — exactly one branch is typically set [UNVERIFIED].

Sub-resources: `/candidates/{id}/applications` (+`/active`), `/attachments`, `/availability`,
`/floats`, `/notes`, `/photo`, `/placements` (+`/approved`), `/skills`, `/submissions`, `/videos`,
`/interviews` [DOCS]. Attachment metadata (`CandidateAttachmentModel`): `attachmentId`, `type`,
`category`, `fileName`, `fileType`, `expiry`, `createdBy/At`, `candidateId` [DOCS]. Attachment
type values: `Resume`, `FormattedResume`, `CoverLetter`, `Screening`, `Check`, `Reference`,
`License`, `Other` [DOCS].

## Application (JobApplication) — `/applications`, id `applicationId` (int64)

The candidate↔job join + workflow state. `JobApplicationRepresentation` [DOCS]:

| Field           | Type                       | Notes                                         |
| --------------- | -------------------------- | ---------------------------------------------- |
| `applicationId` | int64 (required)           |                                                |
| `jobTitle` / `jobReference` | string         | Denormalised from the job                      |
| `manual`        | bool                       | Manually added vs applied via ad               |
| `source`        | string                     |                                                |
| `rating`        | int                        |                                                |
| `status`        | JobApplicationStatusModel  | `{statusId, name, active, rejected, default, defaultRejected, workflow{stage, stageIndex, step, progress}}` |
| `review`        | JobApplicationReviewModel  | `{stage: Submitted\|Viewed\|Accepted\|Rejected, submittedAt/By, reviewedAt/By}` |
| `candidate`     | CandidateSummaryModel      | Full summary nested                            |
| `job`           | JobOrderSummaryModel       |                                                |
| `jobAd`         | JobAdSummaryModel          | Present when applied via an ad                 |
| `submittedDetails` | object                  | Resume/cover-letter info as submitted          |
| `screening`     | object                     | Screening Q&A from the ad                      |
| `custom`        | CustomFieldValueModel[]    | `/applications/fields/custom`                  |
| `owner`         | UserNameModel              |                                                |
| audit fields    |                            |                                                |

Application **status** is the funnel position (account-configurable workflow:
`/applications/lists/status`, `/applications/lists/workflow`). The **review** object is the
client-submission review loop (accept/reject by a contact) — a separate axis [DOCS].

## Placement — `/placements`, id `placementId` (read + update ONLY)

`PlacementRepresentation` [DOCS]:

| Field            | Type             | Notes                                            |
| ---------------- | ---------------- | ------------------------------------------------- |
| `placementId`    | int (required)   |                                                   |
| `type`           | enum (required)  | `Permanent` \| `Contract` \| `Temporary` \| `Credit` |
| `jobTitle`, `job`, `candidate`, `company`, `contact` | nested | The full who/what    |
| `approved` / `approvedAt` | bool/date-time | Approval gate; `/placements?approved=true` |
| `status`         | StatusModel      | `/placements/lists/status`                        |
| `startDate` / `endDate` | date      |                                                   |
| `summary`        | string           |                                                   |
| `paymentType`    | string           | `/placements/lists/paymenttypes`                  |
| `salary`         | PlacementSalaryModel | `{base, superannuation, benefits, total, fee}` (Permanent) |
| `contractRate`   | PlacementContractRateModel | `{ratePer, hoursPerWeek, daysPerWeek, clientRate, candidateRate, onCostsType, onCosts, netMargin}` (Contract/Temp) |
| `chargeCurrency` / `payCurrency` / `rates` | — | [DOCS — official only]              |
| `award` / `industryCode` / `feeSplit` / `billing` / `export` | misc | Payroll/billing config; lists under `/placements/lists/*` |
| `custom`         | CustomFieldValueModel[] | `/placements/fields/custom`                |
| `owner` / `recruiters` | nested     | Recruiters carry fee-split info                   |
| audit fields     |                  |                                                   |

Sub-resources: `/placements/{id}/attachments`, `/notes`, `/timesheets`, `PUT /status` [DOCS].

## Company — `/companies`, id `companyId`

`CompanyRepresentation` [DOCS]: `companyId` (required), `name`, `legalName` [official only],
`status` (StatusModel), `mainContact` (ContactNameModel), `primaryAddress` (CompanyAddressModel),
`summary`, `social` [official only], `parent` (CompanyNameModel — subsidiaries exist:
`/companies/{id}/subsidiaries`), `custom`, `owner`, `recruiters`, audit fields.

Sub-resources: `/companies/{id}/addresses` (CRUD, uuid `addressId`), `/contacts`, `/jobs` (+`/active`),
`/placements` (+`/approved`), `/requisitions`, `/floats`, `/submissions`, `/notes`, `/attachments`,
`/skills`, `/logo`, `/workflows/{workflowType}` [DOCS].

## Contact — `/contacts`, id `contactId` (client-side person)

`ContactRepresentation` [DOCS]: `contactId` (required), `firstName`, `lastName`, `position`,
`salutation`, `email`, `phone`, `mobile` (+`mobileNormalized` [official only]), `status`,
`company` (CompanyNameModel), `officeAddress` (CompanyAddressModel), `otherEmail[]`, `social`,
`summary`, `reportsTo` (ContactNameModel), `hiringManager` (bool — filterable), `unsubscribed` +
`inactive` [official only], `custom`, `owner`, `recruiters`, audit fields.

Sub-resources: `/contacts/{id}/jobs` (+`/active`), `/notes`, `/attachments`, `/skills`, `/photo`,
`/interviews` [DOCS].

## Note — `/notes`, id `noteId` (uuid) — polymorphic

`NoteRepresentation` [DOCS]: `noteId`, `type` (account-specific — `/{entity}/lists/notetype`),
`source`, `subject`, `text` (max 65535 chars per release notes), `reference`, `readonly`,
`attachments[]`, plus link arrays: `jobs[]`, `requisitions[]`, `candidates[]`, `applications[]`,
`placements[]`, `companies[]`, `contacts[]`, audit fields.

## Secondary Entities (read-mostly)

| Entity       | Path            | Id            | Notes                                              |
| ------------ | --------------- | ------------- | --------------------------------------------------- |
| Job Ad       | `/jobads`       | `adId`        | `{state, title, reference, summary, bulletPoints[], description, job, screening, postAt, expireAt}`; POST creates a **draft** [DOCS] |
| User         | `/users`        | `userId`      | Read-only; `/users/current` = whoami; offices + groups [DOCS] |
| Requisition  | `/requisitions` | `requisitionId` | Internal job requests; submit/approve/reject lifecycle; the ONE core entity with DELETE [DOCS] |
| Interview    | `/interviews`   | `interviewId` | Read + per-application internal/external scheduling [DOCS — official only] |
| Folder       | `/folders`      | `folderId` (int64) | GET/POST collection, GET/PATCH item; `folderId` filter on entity lists [DOCS — official only] |
| Opportunity  | `/opportunities`| `opportunityId` | GET/POST collection, GET/PUT item; stages via `/opportunities/lists/stages` [DOCS — official only] |
| Submission   | `/submissions`  | `submissionId` | Candidate→client submissions; read-only [DOCS]      |
| Float        | `/floats`       | `floatId`     | Speculative candidate floats; read-only [DOCS]      |
| Webhook      | `/webhooks`     | `webhookId` (uuid) | Full CRUD — see 01d [DOCS]                     |

Detail worth knowing [DOCS — official spec]:

- **Requisition** mirrors a job's shape (`jobTitle`, `category`, `location`, `salary`, `workType`,
  `numberOfJobs`, `custom`) plus `status`, `workflowStageIndex`, `hiringManager` (contact), and a
  link to the created job via `jobOrderId`. Create requires `contactId` + `jobTitle`.
- **Interview**: `{interviewId, type, startAt, endAt, location, interviewee (application summary),
  interviewers}`. Scheduled per application: internal (user interviewers) or external (contact
  interviewers). Start times only allow minutes 0/15/30/45.
- **Opportunity** (CRM pipeline): create requires `opportunityTitle`, `companyId`, `stageId`
  (string, from `/opportunities/lists/stages`), `ownerUserIds[]`; optional `contactId`,
  `workTypeId`, `value`, `estimatedClose`.
- **Folder**: create takes `{folderName, ownerID}` (note the inconsistent `ID` casing — copy it
  exactly).
- **Submission** summary: `{submissionId, jobTitle, candidate, company, job, audit}` — the
  candidate-to-client submission record behind the application review loop.

## Configuration Lookups (resolve BEFORE writing)

| Lookup                  | Path                                | Used for                        |
| ----------------------- | ----------------------------------- | -------------------------------- |
| Entity statuses         | `/{jobs\|candidates\|applications\|placements\|companies\|contacts}/lists/status` | `statusId` on writes/filters |
| Application workflow    | `/applications/lists/workflow`      | Funnel stages                    |
| Categories              | `/categories`                       | `categoryId`/`subCategoryId` on jobs |
| Locations / Countries   | `/locations`, `/countries`          | `locationId`/`areaId` on jobs    |
| Work types              | `/worktypes`                        | `workTypeId` on jobs             |
| Custom field defs       | `/{entity}/fields/custom`           | `fieldId`, `type`, allowed `values` |
| Sources / ratings / salutations / note types | `/{entity}/lists/source`, `/lists/rating`, `/lists/salutation`, `/lists/notetype` | String values on writes |

All of these are account-specific. **Never hard-code ids across accounts** [DOCS].

## OAuth Scopes (what 403s are about)

Granular scopes exist per resource; `read` / `write` are the umbrella scopes [DOCS]:

- Umbrella: `read`, `write`, plus mandatory `offline_access` for refresh tokens
- Per resource: `read_candidate`/`write_candidate`, `read_company`/`write_company`,
  `read_contact`/`write_contact`, `read_job`/`write_job`, `read_jobad`/`write_jobad`,
  `read_jobapplication`/`write_jobapplication`, `read_placement`/`write_placement`,
  `read_requisition`/`write_requisition`, `read_interview`/`write_interview`,
  `read_events`/`write_events`, `read_folder`/`write_folder`, `read_note`/`write_note`
- Note scopes per entity: `read_candidate_note`/`write_candidate_note` etc.
- Custom-field admin: `manage_candidate_custom`, `manage_job_custom`, etc.
- Read-only extras: `read_float`, `read_submission`, `read_user`, `read_usergroup`, `read_usertask`
- Partner: `partner_jobboard`, `partner_ui_action`

A Numa connection requesting `read write offline_access` covers all normal operations [DOCS];
a 403 on a specific call means the grant was narrower — name the scope above when reporting it.

---

_Companion files: 01-llm-api-rules.md (core rules) · 01b (queries) · 01c (mutations) · 01d (events/errors)._
