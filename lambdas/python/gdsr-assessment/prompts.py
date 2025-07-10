# Core prompt for the GDSR assessment
GDSR_ASSESSMENT_PROMPT = """# Game Development Sector Rebate (GDSR) Assessment Task

Please act as a funding assessor for NZ On Air on GDSR. You are assessing the document contained in Application applying all applicable assessment criteria from the project knowledge in GDSR Reference File. Strictly use the template in Assessment Template as the output format.

## Application
```
{document_content}
```

## GDSR Reference File
```
{gdsr_reference}
```

## Assessment Template
```
{assessment_template}
```

## Markdown Formatting Guidelines:
- Start directly with the template structure provided in Assessment Template
- Maintain all headings, sections, and tables exactly as shown in the template
- Use **bold** for emphasis on important findings, requirements, or decisions
- Use `code formatting` for specific sections of GDSR policy being referenced
- Use > blockquotes to highlight direct quotes from the application document
- Use proper table formatting with | characters and header rows for all tables
- Use bullet points with - for listing multiple items within a section
- Create a visually structured document with clear section separation
- Ensure tables are aligned properly with consistent column widths
- When filling fields with [bracketed placeholders], replace them entirely with your assessment content

As you assess the application:
1. Be thorough and detailed in your evaluation
2. Reference specific criteria from the GDSR Reference File
3. Provide evidence from the Application document to support your assessment
4. Be objective and balanced in your evaluation
5. Make specific, actionable recommendations
6. Follow the Assessment Template format exactly

Do not add any introduction or summary outside the template structure - start directly with the Assessment Checklist Cover Sheet format.
"""

# GDSR reference guide document
GDSR_REFERENCE = """Game Development Sector Rebate (GDSR) Comprehensive Reference Guide

Overview
The Game Development Sector Rebate (GDSR) is a government initiative designed to support the growth of New Zealand's game development sector. It provides a 20% rebate on eligible expenditure for qualifying businesses, with a maximum rebate of $3,000,000 NZD per application period and a minimum threshold of $250,000 in eligible expenditure.

Key Program Details
• Annual funding: $40 million per annum (less scheme administration costs)
• Rebate rate: 20% of eligible expenditure
• Maximum rebate: $3,000,000 NZD per applicant per year
• Minimum eligible expenditure: $250,000 per year
• Eligibility period: April 1 to March 31 each year
• Administrator: NZ On Air
• Policy responsibility: Ministry of Business, Innovation and Employment (MBIE)

Application Process Timeline
1. Registration Phase (beginning of calendar year):
   o Businesses must register through the NZ On Air portal
   o Registration period typically lasts one month
   o Assessment of eligibility based on registration information
   o Notification via Letter of Acknowledgement or Letter of Decline

2. Application Phase (April):
   o For businesses that received a Letter of Acknowledgement
   o Applications cover eligible expenditures from previous financial year (April 1 - March 31)
   o Six-week submission period after eligibility period ends
   o Submission of financial and game project details using provided templates

3. Assessment and Payment (post-April):
   o Review of applications by NZ On Air
   o Possible requests for additional information
   o About 20% of successful applicants are audited each year
   o Publication of recipients' names and aggregate funding disbursed
   o Individual funding amounts published in dollar bands two years later

Eligibility Criteria

Eligible Businesses
• New Zealand residents with a New Zealand Company Number, OR
• Foreign residents with a permanent establishment in New Zealand and a NZ Company Number
• Must undertake relevant game development activity

Eligible Games
Inclusions:
• Digital games intended for general public release
• Entertainment or educational purposes, including serious games
• Formats including VR, AR, mobile, tablet, console, hybrid, installation, web browsers, PC, and multiplatform games

Exclusions:
• Gambling services or games substantially comprised of gambling
• Games with mechanics allowing real money winnings
• Games containing material that would be refused classification by Te Mana Whakaatu Classification Office
• Games containing pornography
• Gamified software primarily designed for another purpose
• Linear content with limited interactivity
• Games intended for commercial advertising purposes

Note on Lootboxes: Games with lootboxes are eligible unless they involve mechanics allowing real money winnings. Applicants must disclose lootbox use in their applications.

Eligible Digital Assets
Businesses that develop digital assets for the game development industry (without developing games themselves) may qualify. These assets include:
• 3D Models (characters, vehicles, props)
• Environment textures
• Animations
• User interface elements

Assets must be intended for the game development sector, not for direct consumer use.

Eligible Expenditure
Inclusions:
1. Personnel Costs:
   o Market-level remuneration for NZ-domiciled employees and contractors performing eligible game development functions:
     ▪ Project management
     ▪ Development (game design, programming, engineering)
     ▪ Writing and story designing
     ▪ Production
     ▪ Art and design
     ▪ Marketing and community development
     ▪ Live operations
     ▪ Player research and game quality improvements

2. Development Costs:
   o Research for game development
   o Prototyping
   o User testing, debugging, data collection
   o Game engines and infrastructure
   o Game production software (SaaS) and hardware/software depreciation
   o Online hosting and distribution
   o Classification costs
   o Trademark costs for IP created
   o Licensing of NZ material
   o Conference participation
   o Auditing costs related to GDSR application

Exclusions:
1. General Business Overheads:
   o Insurance, HR, legal services, general auditing
   o Travel, accommodation, catering, hospitality
   o Visas or work permits
   o Financing expenses

2. Other Exclusions:
   o Non-game development staff
   o Staff not domiciled in NZ
   o Land or premises use
   o Other depreciation expenses
   o Expenditures already claimed by another business
   o Expenditures funded by other government grants or subsidies

Eligible Software
Inclusions:
1. Art, Animation, UX and UI Software (Adobe Suite, ZBrush, Maya, Figma)
2. Coding and Version Control Software (JetBrains IDEs, GitHub)
3. Game Development Software (Unity, Unreal Engine)
4. Game Distribution Software (Apple Developer Program, Steamworks)
5. Narrative Design Software (Articy Draft)
6. User Testing, Debugging, and User Data Collection Software (UserTesting, Backtrace)
7. Crash Reporting Software (Bugsplat, Sentry)

Exclusions:
1. General Business Software (Slack, Microsoft Teams, Office, G-Suite)
2. Financial Software (Xero, MYOB)
3. Customer Support Software
4. Marketing and E-Commerce Software
5. Asset Purchase and Freelance Marketplace Software

Edge Cases (requiring additional justification):
• AI software (ChatGPT)
• Analytics software (Appfigures)
• Audio design software (Soundtrap)
• Cloud software (Microsoft Azure, Cloudflare)
• Communication software (Discord)
• Customer support software (Zendesk)
• IT security software (Hexnode)
• Localization Software (Crowdin, Smartling)
• Project Management Software (Jira)

APPROVED SOFTWARE MASTER SHEET REFERENCE This master sheet provides specific guidance for commonly requested software and should be used alongside the general software eligibility criteria above.

CONFIRMED ELIGIBLE SOFTWARE:
Adobe (Art software), Affinity (Art/animation software), Animbot (3D modelling software), Apple Developer Program (Develop and distribute app on Apple software), Articy (Narrative design software), Atlassian - Jira (Project Management), Autodesk Maya (3D art software), BorisFX (VFX Software), Bugsplatt (Crash reporting software), CircleCI (Distributing code across game platforms software), Click-up (Project Management), Cloudflare (Infrastructure), Codecks (Project Management), Confluence (Project Management), Crowdin (Translation service software), Epic Games (Game engine software), GitHub (Version control for game development), Harvest Forecast (Project management), Jetbrains (Programming languages), Marmoset (Art - rendering, texturing tool), Milanote (Project management tool), Movella (Motion tracking and analysis software for VR games), Pager Duty (Crash reporting software), Parsec (connects teams to hardware to maintain workflows), Per Force Helix Core (Game version control), Plastic SCM/Unity (Game engine), Planyway (Project management), red Giant Maxon (Video effects software), Sentry (Crash reporting software), SideFX (3D animation software), Steam (Game platform), Syncsketch (communication and collaboration platform), Test guild (Automation testing software), Trello (Project management), Unity (Game engine), Whole Tomato (Programming software), Whimsical (Project management software), Xsolla (In-game payment software), Z-Brush (3D modelling software), FontLab (Font creation software)

REQUIRES ADDITIONAL ASSESSMENT - AI Software (determine if used by dev team vs marketing/ops): ChatGPT, MidJourney, OpenAI, ArtAI, Anthropic, Claude.ai, Poe.com, Runway, Magnific, Blockade labs, Suno
REQUIRES ADDITIONAL ASSESSMENT - Analytics Software (determine if used by dev team vs marketing/ops): Appfigures, Appsflyer
REQUIRES ADDITIONAL ASSESSMENT - Training Software (determine if included within employee contracts): Training programs, Animator Guild, Audible
REQUIRES ADDITIONAL ASSESSMENT - Cloud Software (determine if used to host/power games vs general business): Microsoft Azure, Vultr, Dreamhost, Backblaze, Wasabi Technologies, Zappie Host
REQUIRES ADDITIONAL ASSESSMENT - Music/Audio Software (NZ-based team members only): Soundtrap, Ableton, Cargo Cult - Envy
REQUIRES ADDITIONAL ASSESSMENT - Conditional Eligibility: Figma (only if used by game dev art team, not marketing), Sketchfab (only if used by dev team, not marketing), Librato (only if used by dev team, not ops), Solarwinds (only if used by dev team, not ops), Hexnode (only if protecting players), paddle.net (only if used for in-game payments), Miro (to be discussed), Nuclino (to be discussed)
REQUIRES ADDITIONAL ASSESSMENT - Research Software (only if for research, not entertainment): Boardgamearena, Purchase of games, Debug Magazine

CONFIRMED NON-ELIGIBLE SOFTWARE:
Ascend (Accounts payable), Canva (Marketing), Clipdrop (Marketing art), Discord (Communication software), Epidemic sounds (Royalty free music), Ethereum (Bitcoin wallet), FastSpring (SaaS e-commerce platform), Feature Upvote (Customer feedback software), Fiverr (Freelance programmers), FreeScout (Customer support ticketing software), Game Discover Co (Newsletter), GoDaddy (Domain/website registry), Google (General business infrastructure), G-Suite (General business infrastructure), Hootsuite (Social media management), icompetech (Royalty free music), Loomly (Social media management), Microsoft (General business infrastructure), Orchestra (Payroll), Pantheon (Website design), PayPro (Global e-commerce solution), re-purpose.io (Social media and marketing tool), Restream (Multistreaming platform), RSS Comms (Cyber security, cabling/installation, VOIP solutions), Shutterstock (Stock images), Skrapp.io (Email tool), Slack (Team communications tool), Soundly (Sound effect tool), Soundsnap (Sound effect website), Sprout Social (Social Media Management), Synology (Security and back ups), Tailscale (VPN - general business infrastructure), Thinkcell (Microsoft PowerPoint and Excel add-in), TimeOS (Time management software), TIMG (Security), Video game insights (Market analysis), Wavetoys Music (Royalty free music), Webflow (Website design), Wix.com (Website design and hosting), WorkWithIndies (Freelance programmers), YMCA, Flexi-time, Dikas Studio (Fonts - not software as a service), DropBox (File transfer and storage), Zendesk (Customer support ticketing software)

Financial Information Required and Assessment

Required Documentation
1. Financial Statements:
   o Profit and loss statement, cash flow statement, and balance sheet for the current tax year (from April 1)
   o Management accounts from April 1 of the eligibility period
   o Consolidated financial information for head/parent companies if applicable
   o Annual financial statements audited or compiled by a qualified accountant

2. Personnel Information (in Financial Template):
   o Detailed list of personnel roles involved in game development activities
   o Specific salary/costs attributed to eligible game development activities
   o Complete list of contractors who worked in the games development space
   o Non-NZ tax resident contractors/staff and detailed accounting of time spent on eligible activities
   o Documentation of well-structured market-level remuneration packages
   o Evidence of payment via regular payroll systems including PAYE and other taxes

3. Company Structure (in Financial Template):
   o Clear indication of subsidiary status
   o Detailed explanation of related party transaction treatment
   o Documentation of cost attribution methodology between parent and subsidiary
   o Ownership structure and any changes during the eligibility period

4. Non-Eligible Games Development (in Financial Template):
   o Detailed breakdown of costs associated with non-eligible games
   o Evidence of cost allocation methodology (pro-rata basis or timesheet system)
   o Clear separation between eligible and non-eligible game development activities

5. Other Funding Sources (in Financial Template):
   o Comprehensive list of claims under other domestic/international funding or grants
   o Amounts received and applied for during the eligibility period
   o Documentation showing how these funds were used separately from GDSR-claimed expenses

6. Additional Financial Information:
   o Any other relevant financial statements or documentation that assists in determining eligibility

Financial Assessment Methodology
1. Accounting Systems Requirements:
   o Applicants must have an accounting system that allows tracking of expenditure on individual projects and across eligible/ineligible GDSR expenditure
   o Advanced financial capabilities and financial statements prepared on an accrual accounting basis
   o Payroll system able to track time spent on individual projects

2. Eligible Expenditure Verification:
   o All expenditure is checked to ensure it falls within the eligibility period (April 1 - March 31)
   o Verification that expenses are directly related to game development activities
   o Confirmation that staff are NZ-domiciled for personnel expenses
   o Validation that software expenses fall within eligible categories
   o Cross-checking to ensure no double-claiming by contractors and main applicants

3. Related Party Transaction Assessment:
   o Careful review to ensure commercial reasonableness
   o Verification of arm's length pricing
   o Assessment of cost attribution methodologies between related entities
   o Documentation of transfer pricing policies if applicable

4. Exclusion of GST:
   o Confirmation that all claimed amounts exclude GST
   o Verification of correct currency conversion for international expenses

5. Cross-Checking with Other Government Funding:
   o Verification that expenses claimed have not been funded by other government grants or subsidies
   o Coordination with other funding agencies to confirm no double-funding has occurred

6. Audit Procedures:
   o Approximately 20% of applications undergo detailed audit
   o Cost reporting and accounting systems assessment
   o Verification of eligible staff and contractors
   o Cross-verification of game development activities with submitted game details
   o Independent assessment of cost allocations

7. Financial Readiness Evaluation:
   o Assessment of applicant's ability to accurately track and report expenses
   o Evaluation of financial management capabilities
   o Verification of appropriate separation between personal and business expenses
   o Confirmation of proper documentation retention practices

Application Templates
The application requires completion of several templates:
1. Financial Details Template with sections for:
   o Employee and Contractor Summary
   o Expense Summary
   o Profit and Loss
   o Project Eligibility
   o Company Structure
   o Depreciation
   o Other Government Funding

2. Game Details Template

Terms and Conditions

General Terms
• NZ On Air may vary Guidelines and Terms of Trade without notice
• All information submitted must be accurate and complete
• Expenditure must be in New Zealand Dollars
• Businesses must respond timely to NZ On Air questions
• Successful applicants may need to participate in evaluation activities
• NZ On Air will publish recipient names and funding amounts

Registration-Specific Terms
• Registration approval doesn't guarantee application approval
• Registered businesses must inform NZ On Air of material changes affecting eligibility
• Businesses must disclose government funding received or applied for
• Businesses ceasing to be eligible during the period may not receive rebate
• NZ On Air has the right to audit accounting processes and systems
• NZ On Air has the right to visit business premises to observe game development activity

Application-Specific Terms
• Only registered businesses can submit Final Applications
• Applications must be submitted within specified timeframe
• Related party transactions will be carefully reviewed
• Applications may be independently assessed
• If demand exceeds available funds, rebates may be proportionally distributed
• NZ On Air retains audit rights within 12 months of period end
• False information may require repayment of funds plus interest
• Successful applicants must meet Accreditation Requirements

Over-Subscription Protocol
If eligible applications collectively exceed the annual funding available, NZ On Air will allocate funding on a pro-rata basis. NZ On Air will attempt to indicate the likelihood of over-subscription based on registration information.

Auditing and Verification
• NZ On Air reserves the right to conduct audits on approximately 20% of successful applicants each year
• Independent assessments of cost reporting and accounting processes
• On-site evaluations to observe game development activity
• Audit rights retained within 12 months of eligibility period end

Fraudulent Claims
Fraudulent claims will be pursued under relevant legislation and may incur penalties. Businesses found to have provided false information may be required to repay funds plus interest calculated on IRD's Underpayment of Tax (UOMI) rate.

Additional Requirements for Recipients
• Apply GDSR accreditation to acknowledge support
• Contribute information for a catalogue of supported projects
• Participate in evaluation activities to assess program performance"""

# Assessment template structure
ASSESSMENT_TEMPLATE = """
# GDSR Assessment Checklist Cover Sheet

**Applicant name**:
- …
**Funding round**:
- …
**Games eligibility assessors**:
- …
**Financial information assessors**:
- …

**Assessor conflict of Interest Declarations**:
I [insert assessor name] declare I have no interest in [name of applicant] or this application.

**Amount of GDSR Applied For**: $xxx,xxx
**Amount of GDSR recommended for approval**: $yyy,yyy
**Reason for difference (if any)**: [Summarise reasons for adjustment]

**Have all queries raised during the assessment been satisfactorily addressed?** Yes/No
**Selected for Audit?** Yes/No
**Financial Assessment peer reviewed by**:
**Agreed amount recommended for approval after peer review**:

## Key Information

**Documents submitted**:
-
-

**Contact details**:

**Group structure**: [note: review Companies Register to understand shareholdings]

**Other govt funding listed as**: (total $xxxx)
- …
- …

**Loot boxes**: yes/no. Loot boxes assessed as acceptable/not acceptable. Add relevant detail

## Game Development Activity Verified

**Interactivity**: Look for elements such as player input, decision-making, and responsive feedback from the game system. Does the player have agency to make meaningful decisions that affect the outcome? Yes/No

**Rules and Mechanics**: Look for structured gameplay systems that govern player behavior and progression. Are there clear objectives, challenges, or constraints that guide player actions? Yes/No

**Player Influence on Outcome**: Look for dynamic systems where player decisions have consequences within the game world. Are there multiple paths or outcomes based on player choices and actions? Yes/No

**Final Evaluation**: Do you think this product/s meets the definition of a digital game as per the GDSR policy wording?

**Other information from online application**:

## Software Eligibility Assessment

**Software claimed in application**:
- List all software mentioned in the application

**Software assessment summary**:
| Software | Category | Assessment | Eligible | Reason |
|----------|----------|------------|----------|--------|
| [Software Name] | [Art/Development/etc.] | [Approved/Conditional/Rejected] | [Yes/No/Partial] | [Justification] |

**Key software findings**:
- **Confirmed eligible**: [List software that is clearly eligible]
- **Requires further assessment**: [List software needing additional justification]
- **Not eligible**: [List software that is excluded with reasons]

**Software cost adjustments**:
- **Total software costs claimed**: $[amount]
- **Eligible software costs**: $[amount]
- **Excluded software costs**: $[amount] - [reasons for exclusion]

## Recommended for Approval

| Category of expenditure | Amount claimed | Amount recommended for approval | Reason for adjustment |
|-------------------------|----------------|----------------------------------|------------------------|
| Employee Costs | X | X | |
| Other staff costs | X | X | |
| Hosting/subs/IT | X | X | |
| Depreciation costs | X | X | |
| Conference and travel costs | X | X | |
| Other costs | X | X | |
| xxx | X | X | |
| **Total** | $Total | | |
| **Capped at max allowable** | $15,000,000 | | |
| **GDSR at 20%** | $ | | |

**Subject to**:…

## Tests to be Performed

| # | Purpose | Task | Comment | Done |
|---|---------|------|---------|------|
| 1 | Eligible projects/activities have been correctly identified and all games identified as eligible meet the guideline criteria. | Review the list of projects provided. Consider whether the applicant's assessment of whether the projects are eligible or not is correct in terms of the Guidelines. | | |
| 2 | To determine if the figures used for the application relate back to the underlying financial statements | Agree figures in workings to management or final accounts. | | |
| 3 | Consider whether the application is being made at the correct group level and which entities are included. | Review the group structure and confirm that the financial information provided is for the applicant, not another member of the group. | | |
| 4 | Assess if other government grants/funding sources have been correctly treated. | Review information provided (documents and online application) on other grants received. Assess whether any relates to eligible GDSR expenditure. If so, ensure this expenditure has been excluded from the GDSR claim. | | |
| 5 | Other government grants/funding sources disclosed are complete. | Review other information for evidence of government funding: (for grants received in the application period but relate to previous years R&D activities which are not covered in this application, note the amount received only)<br>Previous tax returns of the applicant for RDTI<br>MBIE grants here.<br>Kānoa (MBIE) grants here.<br>Callaghan Innovation grants here. | | |
| 6 | To determine if remuneration expenditure claimed is eligible. [note; the applicant may treat staff costs as expenditure in the profit and loss in the period; they may also be treated as capital expenditure – any staff costs incurred and capitalised in the period of the claim are eligible, staff costs capitalised in previous periods are NOT eligible, nor is any amortisation relating to these eligible] | Review information provided on remuneration expenditure and:<br>Reconcile it to the management accounts/financial statements for the period<br>Review how staff are identified as NZ tax resident/non-resident and ensure non-resident costs are not claimed<br>Review how staff costs are allocated to eligible and non-eligible activities.<br>Check that the allocation is based on reasonable assumptions and is linked to the projects and activities undertaken by the applicant<br>Consider whether any staff costs relating to administration or other ineligible activities have been included in the GDSR claim.<br>Review the costs included in remuneration for eligibility. We would expect gross salary, employer Kiwisaver contribution; annual leave; any other reasonable benefits included in the applicant's remuneration packages (e.g. wellness allowance, Southern cross). This should NOT generally include sick leave allowances.<br>If the application does not provide sufficient detail to perform these tests, request more detail as required. | | |
| 7 | External resources claimed are eligible (NZ domiciled Contractor, sub-contractor or consultant) | Review the details of contractor, sub-contractors or consultant expenditure claimed and assess whether it is related to develop eligible games production. | | |
| 8 | Inter-entity expenses are claimed at the right level and not duplicated. | Review any inter-entity transactions to identify if expenditure is being claimed twice. | | |
| 9 | Game development activities performed for other entities (same group or an external entity) are eligible and not claimed twice | | | |
| 10 | Depreciation expenditure claimed is eligible. | For hardware depreciation we will need to see fixed asset register<br>Review the depreciation claimed and ensure it relates only to eligible assets (hardware and software that relates to game development activities).<br>For depreciation claimed, the applicant needs to provide the fixed asset register to enable this assessment. | | |
| 11 | Other (non-staff) expenditure claimed is eligible. | Review the details of any other expenditure claimed against the Guidelines and assess whether it is eligible. | | |
| 11a | Software expenditure claimed is eligible according to approved software master sheet. | Review all software claimed against the Approved Software Master Sheet Reference:<br>- Check if software is in CONFIRMED ELIGIBLE list<br>- For software requiring additional assessment, verify usage context (dev team vs marketing/ops, NZ-based staff, etc.)<br>- Exclude software in CONFIRMED NON-ELIGIBLE list<br>- Apply conditional eligibility tests for edge cases<br>- Document specific software assessment decisions | | |
| 12 | To confirm that the calculation for the submitted claim amount is correct. | Trace all figures included in the summary of the claim to the supporting information that is reviewed under other steps to check the overall calculation is based on the correct figures.<br>Check the amount claimed represents 20% of the eligible expenditure. | | |"""
