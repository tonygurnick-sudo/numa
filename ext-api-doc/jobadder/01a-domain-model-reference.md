---
api_name: JobAdder
api_slug: jobadder
base_url: https://api.jobadder.com/v2
path_version_segment: /v2 is a REAL path segment, already in base_url — do NOT add another
urls: ABSOLUTE REQUIRED (`https://api.jobadder.com/v2/...`); relative paths fail
call_surface: HTTP via `numa integrations request` (connector=jobadder)
field_casing: camelCase
id_format: int (`jobId`,`candidateId`,`companyId`,`contactId`,`placementId`; `userId` int32; `applicationId` int64); uuid (`noteId`,`addressId`,`webhookId`,partner `actionId`)
companions: 01=api-rules, 01b=queries, 01c=mutations, 01d=events+errors
confidence: docs-derived from official OpenAPI spec (2026-06-10); NOT live-validated. Default source = official spec. Inline tags only when non-default: [official only]=in official spec but not the community mirror; [SPEC-community]=community mirror only; [UNVERIFIED]=inference. GET a real record and mirror its field names before writing.
---

# JobAdder — Domain Model Reference

## Recruitment Workflow Hierarchy

Everything hangs off **Jobs** (job orders) and **Candidates**, joined by **Applications**, ending in **Placements**:

```
Company (client business)
  ├── Contacts (client-side people; hiringManager flag)
  ├── Addresses (uuid-keyed; workplace addresses for jobs)
  └── Jobs (JobOrder — the vacancy/order to fill)
        ├── Job Ads (adId — the board advertisement)   ← separate entity!
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

Consequences:

- A "job" in conversation = **JobOrder** (`/jobs`, `jobId`). A "job ad" = `/jobads` (`adId`). Don't mix them.
- The **Application** is the workflow object — moving a candidate through stages updates the application's status, not the candidate or job.
- **Placements are UI-created** when an application is placed; API is read/update only.
- Notes are polymorphic — one note can link to multiple jobs/candidates/applications/etc.

## ID & Format Semantics

- Core ids int: `jobId`,`candidateId`,`companyId`,`contactId`,`placementId`; `userId` int32; `applicationId` int64.
- UUIDs: `noteId`, `addressId` (company addresses), `webhookId`, partner `actionId`.
- camelCase throughout (`jobTitle`,`statusId`,`createdAt`,`ownerUserId`).
- Timestamps: ISO 8601 date-time, UTC assumed (`2026-01-01T09:00:00Z`); plain dates `yyyy-MM-dd` (`startDate`,`endDate`).

## Shared Sub-Objects (recur across entities)

| Model                   | Fields                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `StatusModel`           | `statusId`(int), `name`, `active`(bool), `default`(bool)                                                              |
| `UserNameModel`         | `userId`,`firstName`,`lastName`,`position`,`email`,`phone`,`mobile`,`inactive`,`deleted`                              |
| `AddressModel`          | `street`(array of strings!), `city`, `state`, `postalCode`, `country`, `countryCode`                                  |
| `CompanyAddressModel`   | `addressId`(uuid), `name`, `street[]`, `city`, `state`, `postalCode`, `country`, `countryCode`, `phone`, `fax`, `url` |
| `CustomFieldValueModel` | `fieldId`, `name`, `type`(`Text\|List\|Date\|Lookup`), `value`                                                        |
| Audit                   | `createdBy`/`createdAt`, `updatedBy`/`updatedAt` (+ `closedBy`/`closedAt` on jobs) on every core entity               |

`street` being an array is an easy write-bug: `{"street":["1 Queen St"],"city":"Auckland"}`.

## Read Shapes: Representation vs Summary

- **`{Entity}Representation`** — full object; single GETs (`/jobs/{jobId}`) and creates (201).
- **`{Entity}SummaryModel`** — trimmed; inside list `items[]` and when nested (an application embeds `CandidateSummaryModel`).

Summaries keep ids/names/status/audit but drop deep nests (employment history, education, custom fields, statistics). **If a field is missing from a list result, GET the single record** — don't assume the data is absent.

## Custom Fields

`GET /{entity}/fields/custom` → `CustomFieldModel`: `fieldId`,`name`,`type`(`Text|List|Date|Lookup`),`mandatory`,`maxLength`,`multiLine`,`multiSelect`,`values[]` (allowed values for List). Reads return `custom:[{fieldId,name,type,value}]`; writes send `custom:[{fieldId,value}]`. Respect `mandatory`/`maxLength`/`values` or expect 422.

## Job (JobOrder) — `/jobs`, id `jobId`

`JobOrderRepresentation`:
| Field | Type | Notes |
| --- | --- | --- |
| `jobId` | int (required) | |
| `jobTitle` | string | only required field on create |
| `company` | CompanyNameModel | `{companyId,name}` nested on read |
| `contact` | ContactNameModel | client-side hiring contact |
| `status` | StatusModel | account-specific; `/jobs/lists/status` |
| `source` | string | `/jobs/lists/source` |
| `jobDescription` | string | |
| `numberOfJobs` | int | openings count |
| `workplaceAddress` | CompanyAddressModel | |
| `category` | JobOrderCategoryModel | `{categoryId,name,subCategory}` — `/categories` |
| `location` | JobOrderLocationModel | `{locationId,name,area}` — `/locations` |
| `start` | JobOrderStartModel | `{immediate,relative,date}` |
| `endDate` | date | [official only] |
| `duration` | DurationModel | `{period,unit:Hour\|Day\|Week\|Month}` |
| `workType` | WorkTypeModel | `{workTypeId,name,ratePer}` — `/worktypes` |
| `workShift` / `jobType` | object/string | [official only; shapes unmined] |
| `salary` | JobOrderSalaryRangeModel | `{ratePer:Hour..Year,rateLow,rateHigh,currency,timePerWeek}` |
| `fee` | JobOrderFeeModel | |
| `skillTags` | JobOrderSkillTags | |
| `custom` | CustomFieldValueModel[] | `/jobs/fields/custom` |
| `owner` / `recruiters` | UserNameModel / [] | |
| `requisitionId` | int | link to originating requisition [official only] |
| `userFavourite` | bool | |
| `statistics` | object | opt-in via `fields=statistics` |
| audit | | + `closedBy`/`closedAt` |

List: `{items:JobOrderSummaryModel[], totalCount, links}`.

## Candidate — `/candidates`, id `candidateId`

`CandidateRepresentation`:
| Field | Type | Notes |
| --- | --- | --- |
| `candidateId` | int (required) | |
| `firstName`/`lastName` | string | |
| `email` | string | dedupe key on create (409 on dupe) |
| `phone`/`mobile` | string | + `mobileNormalized` read-only [official only] |
| `contactMethod` | string | |
| `salutation` | string | `/candidates/lists/salutation` |
| `address` | AddressModel | `street` is an array |
| `status` | StatusModel | `/candidates/lists/status` |
| `rating` | string | `/candidates/lists/rating` |
| `source` | string | `/candidates/lists/source` |
| `seeking` | enum | `Yes`\|`Maybe`\|`No` |
| `otherEmail` | string[] | |
| `social` | object | free-form handles |
| `summary` | string | |
| `dateOfBirth` | date | [official only] |
| `emergencyContact`/`emergencyPhone` | string | [official only] |
| `unsubscribed` | bool | marketing opt-out [official only] |
| `employment` | CandidateEmploymentModel | `{current,ideal,history[{employer,position,start,end,description}]}` |
| `availability` | CandidateStartModel | `{immediate,relative,date}` |
| `education` | CandidateEducationModel[] | |
| `skillTags` | string[] | |
| `custom` | CustomFieldValueModel[] | `/candidates/fields/custom` |
| `recruiters` | UserNameModel[] | |
| `statistics` | object | opt-in via `fields=` |
| audit | | |

Employment sub-shapes: `employment.current`=`{employer,position,workType,salary}`; `employment.ideal`=`{position,workType,salary(range),other[]}`; `employment.history[]`=`{employer,position,start,end,description}`. `availability`/`start` share `{immediate:bool, relative:{period,unit}, date}` — exactly one branch typically set [UNVERIFIED].

Sub-resources: `/candidates/{id}/applications`(+`/active`), `/attachments`, `/availability`, `/floats`, `/notes`, `/photo`, `/placements`(+`/approved`), `/skills`, `/submissions`, `/videos`, `/interviews`. Attachment metadata (`CandidateAttachmentModel`): `attachmentId`,`type`,`category`,`fileName`,`fileType`,`expiry`,`createdBy/At`,`candidateId`. Attachment `type` values: `Resume`,`FormattedResume`,`CoverLetter`,`Screening`,`Check`,`Reference`,`License`,`Other`.

## Application (JobApplication) — `/applications`, id `applicationId` (int64)

The candidate↔job join + workflow state. `JobApplicationRepresentation`:
| Field | Type | Notes |
| --- | --- | --- |
| `applicationId` | int64 (required) | |
| `jobTitle`/`jobReference` | string | denormalised from the job |
| `manual` | bool | manually added vs applied via ad |
| `source` | string | |
| `rating` | int | |
| `status` | JobApplicationStatusModel | `{statusId,name,active,rejected,default,defaultRejected,workflow{stage,stageIndex,step,progress}}` |
| `review` | JobApplicationReviewModel | `{stage:Submitted\|Viewed\|Accepted\|Rejected, submittedAt/By, reviewedAt/By}` |
| `candidate` | CandidateSummaryModel | nested |
| `job` | JobOrderSummaryModel | |
| `jobAd` | JobAdSummaryModel | present when applied via an ad |
| `submittedDetails` | object | resume/cover-letter as submitted |
| `screening` | object | screening Q&A from the ad |
| `custom` | CustomFieldValueModel[] | `/applications/fields/custom` |
| `owner` | UserNameModel | |
| audit | | |

Application **status** = funnel position (account-configurable: `/applications/lists/status`, `/applications/lists/workflow`). The **review** object is the client-submission review loop (accept/reject by a contact) — a separate axis.

## Placement — `/placements`, id `placementId` (read + update ONLY)

`PlacementRepresentation`:
| Field | Type | Notes |
| --- | --- | --- |
| `placementId` | int (required) | |
| `type` | enum (required) | `Permanent`\|`Contract`\|`Temporary`\|`Credit` |
| `jobTitle`,`job`,`candidate`,`company`,`contact` | nested | full who/what |
| `approved`/`approvedAt` | bool/date-time | approval gate; `/placements?approved=true` |
| `status` | StatusModel | `/placements/lists/status` |
| `startDate`/`endDate` | date | |
| `summary` | string | |
| `paymentType` | string | `/placements/lists/paymenttypes` |
| `salary` | PlacementSalaryModel | `{base,superannuation,benefits,total,fee}` (Permanent) |
| `contractRate` | PlacementContractRateModel | `{ratePer,hoursPerWeek,daysPerWeek,clientRate,candidateRate,onCostsType,onCosts,netMargin}` (Contract/Temp) |
| `chargeCurrency`/`payCurrency`/`rates` | — | [official only] |
| `award`/`industryCode`/`feeSplit`/`billing`/`export` | misc | payroll/billing; lists under `/placements/lists/*` |
| `custom` | CustomFieldValueModel[] | `/placements/fields/custom` |
| `owner`/`recruiters` | nested | recruiters carry fee-split info |
| audit | | |

Sub-resources: `/placements/{id}/attachments`, `/notes`, `/timesheets`, `PUT /status`.

## Company — `/companies`, id `companyId`

`CompanyRepresentation`: `companyId`(required), `name`, `legalName` [official only], `status`(StatusModel), `mainContact`(ContactNameModel), `primaryAddress`(CompanyAddressModel), `summary`, `social` [official only], `parent`(CompanyNameModel — subsidiaries: `/companies/{id}/subsidiaries`), `custom`, `owner`, `recruiters`, audit.

Sub-resources: `/companies/{id}/addresses` (CRUD, uuid `addressId`), `/contacts`, `/jobs`(+`/active`), `/placements`(+`/approved`), `/requisitions`, `/floats`, `/submissions`, `/notes`, `/attachments`, `/skills`, `/logo`, `/workflows/{workflowType}`.

## Contact — `/contacts`, id `contactId` (client-side person)

`ContactRepresentation`: `contactId`(required), `firstName`, `lastName`, `position`, `salutation`, `email`, `phone`, `mobile`(+`mobileNormalized` [official only]), `status`, `company`(CompanyNameModel), `officeAddress`(CompanyAddressModel), `otherEmail[]`, `social`, `summary`, `reportsTo`(ContactNameModel), `hiringManager`(bool — filterable), `unsubscribed`+`inactive` [official only], `custom`, `owner`, `recruiters`, audit.

Sub-resources: `/contacts/{id}/jobs`(+`/active`), `/notes`, `/attachments`, `/skills`, `/photo`, `/interviews`.

## Note — `/notes`, id `noteId` (uuid) — polymorphic

`NoteRepresentation`: `noteId`, `type` (account-specific — `/{entity}/lists/notetype`), `source`, `subject`, `text` (max 65535 chars), `reference`, `readonly`, `attachments[]`, plus link arrays: `jobs[]`, `requisitions[]`, `candidates[]`, `applications[]`, `placements[]`, `companies[]`, `contacts[]`, audit.

## Secondary Entities (read-mostly)

| Entity      | Path             | Id                 | Notes                                                                                                                |
| ----------- | ---------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Job Ad      | `/jobads`        | `adId`             | `{state,title,reference,summary,bulletPoints[],description,job,screening,postAt,expireAt}`; POST creates a **draft** |
| User        | `/users`         | `userId`           | read-only; `/users/current`=whoami; offices + groups                                                                 |
| Requisition | `/requisitions`  | `requisitionId`    | internal job requests; submit/approve/reject lifecycle; the ONE core entity with DELETE                              |
| Interview   | `/interviews`    | `interviewId`      | read + per-application internal/external scheduling [official only]                                                  |
| Folder      | `/folders`       | `folderId` (int64) | GET/POST collection, GET/PATCH item; `folderId` filter on entity lists [official only]                               |
| Opportunity | `/opportunities` | `opportunityId`    | GET/POST collection, GET/PUT item; stages via `/opportunities/lists/stages` [official only]                          |
| Submission  | `/submissions`   | `submissionId`     | candidate→client submissions; read-only                                                                              |
| Float       | `/floats`        | `floatId`          | speculative candidate floats; read-only                                                                              |
| Webhook     | `/webhooks`      | `webhookId` (uuid) | full CRUD — see 01d                                                                                                  |

Detail [official spec]:

- **Requisition** mirrors a job's shape (`jobTitle`,`category`,`location`,`salary`,`workType`,`numberOfJobs`,`custom`) + `status`, `workflowStageIndex`, `hiringManager`(contact), and `jobOrderId` linking to the created job. Create requires `contactId`+`jobTitle`.
- **Interview**: `{interviewId,type,startAt,endAt,location,interviewee(application summary),interviewers}`. Per application: internal (user interviewers) or external (contact interviewers). Start times only allow minutes 0/15/30/45.
- **Opportunity** (CRM pipeline): create requires `opportunityTitle`,`companyId`,`stageId`(string, from `/opportunities/lists/stages`),`ownerUserIds[]`; optional `contactId`,`workTypeId`,`value`,`estimatedClose`.
- **Folder**: create `{folderName, ownerID}` (note the inconsistent `ID` casing — copy exactly).
- **Submission** summary: `{submissionId,jobTitle,candidate,company,job,audit}` — the candidate-to-client record behind the application review loop.

## Configuration Lookups (resolve BEFORE writing — all account-specific; never hard-code ids across accounts)

| Lookup                                 | Path                                                                              | Used for                             |
| -------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| Entity statuses                        | `/{jobs\|candidates\|applications\|placements\|companies\|contacts}/lists/status` | `statusId` on writes/filters         |
| Application workflow                   | `/applications/lists/workflow`                                                    | funnel stages                        |
| Categories                             | `/categories`                                                                     | `categoryId`/`subCategoryId` on jobs |
| Locations / Countries                  | `/locations`, `/countries`                                                        | `locationId`/`areaId` on jobs        |
| Work types                             | `/worktypes`                                                                      | `workTypeId` on jobs                 |
| Custom field defs                      | `/{entity}/fields/custom`                                                         | `fieldId`, `type`, allowed `values`  |
| Sources/ratings/salutations/note types | `/{entity}/lists/source`, `/lists/rating`, `/lists/salutation`, `/lists/notetype` | string values on writes              |

## OAuth Scopes (what 403s are about)

Granular scopes per resource; `read`/`write` are the umbrella scopes:

- Umbrella: `read`, `write`, + mandatory `offline_access` (refresh tokens).
- Per resource: `read_candidate`/`write_candidate`, `read_company`/`write_company`, `read_contact`/`write_contact`, `read_job`/`write_job`, `read_jobad`/`write_jobad`, `read_jobapplication`/`write_jobapplication`, `read_placement`/`write_placement`, `read_requisition`/`write_requisition`, `read_interview`/`write_interview`, `read_events`/`write_events`, `read_folder`/`write_folder`, `read_note`/`write_note`.
- Note scopes per entity: `read_candidate_note`/`write_candidate_note` etc.
- Custom-field admin: `manage_candidate_custom`, `manage_job_custom`, etc.
- Read-only extras: `read_float`, `read_submission`, `read_user`, `read_usergroup`, `read_usertask`.
- Partner: `partner_jobboard`, `partner_ui_action`.

A Numa connection requesting `read write offline_access` covers all normal operations; a 403 on a specific call means the grant was narrower — name the scope above when reporting.
