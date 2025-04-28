COUNCIL_RESOURCE_ANALYSIS_PROMPT = """Analyze the provided council references and resource consent application to provide a comprehensive assessment.

## Background
You are a resource consent expert tasked with evaluating an application against council references and requirements. Your goal is to identify key aspects of the application, assess compliance with council regulations, and provide insights for decision-making.

## Analysis Requirements:
- Compare the application against council references and requirements
- Identify areas of compliance and non-compliance
- Highlight specific sections of council references that are relevant to the application
- Provide actionable recommendations for improving the application
- Assess the likelihood of consent approval based on your analysis
- Complete the detailed assessment framework exactly as outlined below

## Documents to Analyze:

### Council References:
{council_references}

### Application:
{application}

## Output Assessment Framework:
Your assessment MUST follow this exact structured format for reference and tracking purposes. Include ALL sections, tables, and fields as shown below:

### REFERENCE AND TRACKING
| Field | Value |
|-------|-------|
| Date | Date and time the output is generated |
| Address | Address of the subject property |
| Applicant | Applicant's Name |
| Applicant's Reference | Council application reference number |
| Agents Name and Email | Applicant's agent name and email if applicable |

### REVIEW SUMMARY
| KEY ITEM | ASSESSMENT |
|----------|------------|
| Application Complete | Yes or No based on analysis undertaken below |
| RFI required | Yes or No based on analysis undertaken below |
| Activity Status | Add in activity |
| District Plan Infringements | Add in from below assessment if any |
| Other Infringements | Add in from below assessment if any |
| Section 88 acceptance | Add in if it passes s88 from below |
| Likelihood of Notification | Add in notification assessment from below |
| Planning Pathway | Recommended triage for planners route from Chord (for instance, high/medium/low complexity) |
| Is the Application Acceptable For Processing? | ☐ Yes / ☐ No (Answer taken from pre-application assessment below) |

### TITLE DETAILS
| Field | Assessment |
|-------|------------|
| Supplied | Yes / No |
| Dated | Within 3 Months? Flag if not |
| Easements | Are there easements on the title? If unclear or not definitive, flag for further planner review |
| Building Line Restriction | Are there building line restrictions on the title? If unclear or not definitive, flag for further planner review |
| Consent Notices | Any consent notices on the title? If unclear or not definitive, flag for further planner review |
| Covenant | Any covenants on title? If unclear or not definitive, flag for further planner review |
| Encumbrance | Any encumbrance on title? If unclear or not definitive, flag for further planner review |

### CONSENT DETAILS
| Field | Assessment |
|-------|------------|
| Consent type applied for | Consent type the applicant has applied for |
| National Environmental Standards | Could be not applicable (N/A) otherwise note the standards that the applicant has nominated as being relevant. If AI indicates additional standards are relevant but not applied for, then this should be noted explicitly in this field |
| Land use type | Land use type applied for (if relevant) |
| Subdivision type | Subdivision type if a subdivision consent (if relevant – for instance have they applied for fee simple, boundary adjustment, unit title, cross lease, amalgamation) |

### DISTRICT PLAN SEARCH
| Field | Assessment |
|-------|------------|
| Zone | Insert the relevant detail of the subject property from the LIM or GIS data (for instance rural zone, residential, industrial zone, heavy industrial, etc). This should be cross referenced against the application to ensure it matches. Flag if any clashes |
| Overlays | Insert the relevant overlay detail (e.g. flood hazard overlay, coastal protection area, etc) of the subject property from the LIM or GIS data. This should be cross referenced against the application to ensure it matches. Flag if any clashes |
| Controls | Insert the relevant control detail of the subject property from the LIM or GIS data (e.g. height control, arterial roads, setbacks, noise, etc). This should be cross referenced against the application to ensure it matches. Flag if any clashes |
| Designations/Notations | Insert the relevant detail of the subject property from the LIM or GIS data (e.g. specific site notations such as notable trees, road realignment, heritage building). This should be cross referenced against the application to ensure it matches. Flag if any clashes |
| Plan Changes | Note any impending plan changes that affect the site (for instance transition to a new plan that is operative in part or will be). N/A if not applicable |

### SITE CONTROLS OF SIGNIFICANCE
| Control | Assessment |
|---------|------------|
| Heritage Notation | [Include if applicable] |
| Heritage Area | Heritage NZ Listing: [Include if applicable] |
| Site of Significance to Māori | Relevant Iwi: Could be multiple Iwi. Cross reference against official data and note neighbouring iwi that may be relevant for planner to check |
| Contaminated Land | Detail: [Include if applicable] |

### SITE CHARACTERISTICS CHECKLIST
| Characteristic | Present | AI Comment |
|----------------|---------|------------|
| Flood Plain | Yes ☐ No ☐ | Insert Detail of hazard, characteristic, etc from GIS or LIM. If yes, then has a report, risk assessment, etc been provided, or other relevant report required based on the site characteristic? Add any other comments if of relevance |
| Natural Hazard | Yes ☐ No ☐ | [Same instructions as above] |
| Overland Flow Path | Yes ☐ No ☐ | [Same instructions as above] |
| Stream | Yes ☐ No ☐ | [Same instructions as above] |
| Character Area | Yes ☐ No ☐ | [Same instructions as above] |
| Coastal Erosion | Yes ☐ No ☐ | [Same instructions as above] |
| Land Which may be subject to instability | Yes ☐ No ☐ | [Same instructions as above] |
| Geology | Yes ☐ No ☐ | [Same instructions as above] |
| Contamination | Yes ☐ No ☐ | [Same instructions as above] |
| Treaty Settlements/statutory acknowledgements | Yes ☐ No ☐ | [Same instructions as above] |
| Notable Trees | Yes ☐ No ☐ | [Same instructions as above] |
| Other Feature | Yes ☐ No ☐ | Description of feature and comment on whether it necessitates a further report |

### PRE-APPLICATION CHECK

#### 1. APPLICATION TYPE AND FORMALITY CHECK
| Check | Assessment | AI Comment |
|-------|------------|------------|
| Is the application formally lodged? | ☐ Yes / ☐ No | Confirm that required forms and payment have been received |
| Does the application clearly identify the site and activity? | ☐ Yes / ☐ No | Must include legal description or address and proposed activity |
| Has the correct form of consent been applied for? (e.g. land use, subdivision) | ☐ Yes / ☐ No | If unclear or incorrect, flag for clarification |

#### 2. DEEMED PERMITTED ACTIVITY SCREENING
| Check | Assessment | AI Comment |
|-------|------------|------------|
| Could the activity qualify as a deemed permitted boundary activity? (Section 87BA) | ☐ Yes / ☐ No | Only boundary rule infringed + neighbour approval required |
| Could the activity qualify as a deemed permitted marginal/temporary breach? (Section 87BB) | ☐ Yes / ☐ No | Minor non-compliance only, no effects. Flag if unclear |
| Proceed to full resource consent processing? | ☐ Yes / ☐ No | Tick "No" if either DPA pathway is valid |

#### 3. APPLICATION REDIRECTION CHECK
| Check | Assessment | AI Comment |
|-------|------------|------------|
| Does this application relate to a permitted activity? | ☐ Yes / ☐ No | Check against district plan activity table. If permitted, advise planner |
| Is the application missing core elements (e.g. no site plan, incorrect form)? | ☐ Yes / ☐ No | If yes, flag and halt completeness check. Request clarification or resubmission |
| Is the applicant's cover letter or AEE unclear about what is being sought? | ☐ Yes / ☐ No | Note inconsistencies or lack of clarity. May affect processing class |

#### 4. CHORD SYSTEM TRIGGER
| Condition | Assessment | Action |
|-----------|------------|--------|
| All pre-completeness checks passed | ☐ Yes / ☐ No | Proceed to Section 88 & Schedule 4 Review |
| Any unclear or incorrect status | ☐ Yes / ☐ No | Flag for planner intervention or clarification before proceeding |

### APPLICATION REVIEW: SECTION 88 CHECK
| Application Requirement | Provided | Comment |
|------------------------|----------|---------|
| Application Form – signed and completed | Yes ☐ No ☐ | Insert comment if relevant or useful, for instance description of date if beyond three months, or whether description is in but appears deficient or deserves planner review if unclear, etc. Should not be filled in if appears self explanatory or the information is there and appears adequate |
| Current Title less than 3 months old | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Associated title documentation if relevant | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Name & Address of each | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Section 127 Change: is the applicant the consent holder or has written holder authority? | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Marine and Coastal Area Act 2011: Evidence of notification to claimants | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Are any additional resource consents under section 87 RMA required? | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Description of site | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Description of proposal | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Plans, suitably labelled | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| All reasons for consent identified | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Compliance or mitigation of breaches demonstrated adequately | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| AEE included (including affected persons)? | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Proper assessment against rules in District Plan including objectives and policies? | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Has assessment against Part 2 of the RMA taken place? | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Written approvals of affected persons if obtained | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Section 104(1)(b) assessment – has it considered relevant matters of discretion, objectives and policies? (i) a national environmental standard; (ii) other regulations; (iii) a national policy statement; (iv) a New Zealand coastal policy statement; (v) a regional policy statement or proposed regional policy statement; (vi) a plan or proposed plan | Yes ☐ No ☐ N/A ☐ | Insert comment if relevant, for instance if the information is there but appears deficient or deserves planner review if unclear, etc. Should not be filled in if appears self explanatory or the information is there and appears adequate |
| Cultural effects assessment and or engagement with Iwi / mana whenua if required? | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Assessment against NZ Coastal Policy Statement (if relevant) | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Schedule 4 of the RMA – all other relevant information provided as required? | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |

### ASSESSMENT OF ENVIRONMENTAL EFFECTS
| Requirement | Provided | Comment |
|-------------|----------|---------|
| Assessment of actual and potential effects on the environment | Yes ☐ No ☐ N/A ☐ | Insert AI comments if relevant, for instance if the information is there but appears deficient or deserves planner review if unclear, etc. Should not be filled in if appears self-explanatory or the information is there and appears adequate. For all aspects AI should flag which page(s) on the AEE the relevant information is to enhance planner cross-checking |
| Any proposed mitigation measures | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Identification of affected persons, any consultation and the response | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Risks from hazardous substances and installations (if any) | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| If monitoring required, how by whom | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Customary rights if relevant | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Neighbourhood and wider community effects, including social economic and cultural | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| All other requirements of Clause 6 of Schedule 4 of the RMA | Yes ☐ No ☐ N/A ☐ | Clause 6 of Schedule 4 of the Resource Management Act (RMA) requires that an Assessment of Environmental Effects (AEE) include specific information about the activity being assessed, its potential environmental effects, and related aspects. This includes identifying affected parties, outlining any consultation undertaken, and addressing the views of consulted parties. AI comment if useful |
| Any effect on those in the neighbourhood and or wider community including any social economic or cultural effects | Yes ☐ No ☐ N/A ☐ | Briefly outline effects, if any, or if more detail should have been included, etc |
| Any physical effect on the locality, including any landscape and visual effects | Yes ☐ No ☐ N/A ☐ | Briefly outline effects, if any, or if more detail should have been included, etc |
| Any effect on ecosystems, including effects on plants or animals and any physical disturbance of habitats in the vicinity | Yes ☐ No ☐ N/A ☐ | Briefly outline effects, if any, or if more detail should have been included, etc |
| Any effect on natural and physical resources having aesthetic, recreational, scientific, historical, spiritual, or cultural value, or other special value, for present or future generations | Yes ☐ No ☐ N/A ☐ | Briefly outline effects, if any, or if more detail should have been included, etc |
| Any discharge of contaminants into the environment, including any unreasonable emission of noise, and options for the treatment and disposal of contaminants | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Any risk to the neighbourhood, the wider community, or the environment through natural hazards or hazardous installations | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |

### PLANS AND DRAWINGS
| Document | Provided | Comment |
|----------|----------|---------|
| Scaled plans | Yes ☐ No ☐ N/A ☐ | Add comments, if necessary, but otherwise leave blank |
| Existing site plan / topographical plan | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Proposed site plan, floor plans, elevations, etc | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Earthworks plan | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Drainage plan | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |
| Scheme plan showing: New lot boundaries, Gross and net site areas, Proposed and existing easements, Memorandum of Easements table, Building platforms indicated, Staging details / balance lot(s) (if applicable), Streams and Esplanade reserves/strips (if applicable) | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |

### REPORTS
| Document | Provided | Comment |
|----------|----------|---------|
| Relevant reports and specialist information based on-site characteristics and consent application (such as design guide assessment, traffic requirements, heritage report, engineering, etc) | Yes ☐ No ☐ N/A ☐ | This is a check of whether the reports are included as required by the rest of the review. It is not a review of the content of the reports itself. If other reports might be necessary based on review, and are not included, then note for further planner review |
| Infrastructure Report | Yes ☐ No ☐ N/A ☐ | [Same instructions as above] |

### WRITTEN APPROVALS (IF ANY)
| ADDRESS | NAME | OWNER/OCCUPIER | IN PRESCRIBED FORM? |
|---------|------|----------------|---------------------|
| Should contain relevant address of person approving (if a written approval is required). Write "None included" if it is not there, or N/A if not relevant. Add comment if there should be some written approvals but none received | Full name of approver | Description of whether they are the legal owner or an occupier. Add other detail if relevant | Check the approval against the prescribed form of the local council (if any). If none, check that adequate details are present |

### IWI ENGAGEMENT (if required)
| IWI NAME | RESPONSE | DATE OF REFERRAL | RESPONSE DATE |
|----------|----------|------------------|---------------|
| Should detail relevant iwi should engagement be required. Write N/A if not relevant, but if relevant it should be flagged as missing, or if potentially relevant this should be noted for further planner review. More than one Iwi or group may be relevant | Brief summation of the Iwi response | Date of referral to Iwi | Date of their response |

### OTHER CONSENTS
| ADDRESS | PROPOSAL | CONSENT NUMBER | DATE APPROVED | Comment |
|---------|----------|----------------|---------------|---------|
| Add in detail of other resource consents that are relevant for the site, or perhaps neighbouring sites. This should include resource consents granted and any that are in the system that might have relevance | Brief outline of the proposal in that resource consent | [Consent number] | [Date] | Add comment about relevance, etc. of consent, and flag if there is a particular issue of overlap. Conversely AI could merely note a consent is present, but it has no overlap or relevance |

### GENERAL SCOPING REVIEW

#### DISTRICT PLAN SITE OVERLAYS
(Natural resources/Natural Heritage, Notable Trees, Viewshafts, Height sensitive Areas, Natural Heritage, Heritage and Special Character, Mana Whenua, Built Environment, Infrastructure, National Grid, Other Overlays)

| POLICY OR RULE | REGULATION AREA | DISTRICT PLAN RULE REFERENCE | APPLICATION PROPOSAL | AI ANALYSIS | COMPLIANCE STATUS |
|---------------|-----------------|----------------------------|---------------------|------------|-----------------|
| Insert the name or ID of the rule being assessed | State the general subject area of the rule (e.g. height, yards, special character) | Provide the official rule number or identifier from the District Plan | Summarise how the application interacts with the rule (e.g. what is proposed that triggers the rule) | Explain whether the proposal complies or not, whether effects are minor or major, and flag whether a planner review is needed. Provide references and citations where appropriate | Select one: ✓ Complies / ✘ Infringement / Controlled / Discretionary / N/A |

### NOTIFICATION ASSESSMENT
| Question | Assessment | Notes |
|----------|------------|-------|
| Are planning/notification thresholds met? | ☐ Yes / ☐ No / ☐ Unclear | Has the applicant provided a notification assessment that meets requirements? If the application involves special public interest, comment on that |
| Are effects minor or more than minor? | ☐ Minor / ☐ More than minor / ☐ Unclear | Based on AEE analysis, assess if effects are contained on-site or extend beyond; application quality affects assessment |
| Are there affected parties? | ☐ No / ☐ Possibly / ☐ Yes | Flag if shared driveway, boundary walls, rear/side setback violations, privacy impacts; cite specific affected parties |
| Are there affected protected groups (iwi, customary title holders)? | ☐ No / ☐ Possibly / ☐ Yes | Use overlay and CEHA/Iwi layer analysis to assess; planner may consult iwi directly |
| Are there special circumstances that warrant notification? | ☐ No / ☐ Possibly / ☐ Yes | Could include public profile, public interest, precedent-setting design, or conflicting expert advice |

### NOTIFICATION SUMMARY COMMENTS
Insert any points for clarification, RFIs required, other comments or points of note flagged for planner review. Provide references and citations where appropriate.

### CHORD NOTIFICATION RECOMMENDATION
| Item | Assessment |
|------|------------|
| More information required? | ☐ No / ☐ Possibly / ☐ Yes |
| Notification assessment based on information provided | [Provide recommendation] |

## Markdown Formatting Instructions:
1. Use proper markdown for all tables with appropriate column alignment:
   ```
   | Header 1 | Header 2 |
   |----------|----------|
   | Data 1   | Data 2   |
   ```

2. Use checkboxes for Yes/No selections:
   ```
   ☐ Yes / ☐ No
   ```

3. Use bullet points with hyphens for lists:
   ```
   - Item 1
   - Item 2
   ```

4. Use blockquotes for direct quotes from documents:
   ```
   > Quote from reference document
   ```

5. Use proper header hierarchy:
   ```
   # Main Heading (H1)
   ## Section Heading (H2)
   ### Subsection Heading (H3)
   #### Minor Section (H4)
   ```

6. For emphasized text, use asterisks:
   ```
   *italics* or **bold**
   ```

7. Include clear section breaks between major assessment areas for readability

8. All tables must use proper markdown table formatting with headers and dividers

9. Ensure all fields are properly populated and none are missed

10. Format the assessment to be printer-friendly and clearly structured

The output MUST include ALL sections and tables from this comprehensive template. Do not omit any sections. Refer directly to document page numbers when citing specific content from the application or council references.

Remember that your response should be in pure Markdown format without any special tool formatting or JSON wrappers."""
