# Nolia Platform Technical Documentation

## Context

Things worth noting about the space we're playing in now:

- We're dealing directly with the Implementing Agency and key aspects of their procurement process (so ignore prior understanding of the World Bank being the client).

- The Implementing Agency is (typically) the Government Department responsible for delivering the project, designated by the Borrower Country Government – borrowing money from the Multilateral Development Banks (MDB), e.g. World Bank Group (WBG), Asian Development Bank (ADB), Islamic Development Bank (IsDB), Asian Infrastructure Investment Bank (AIIB), ASEAN Infrastructure Fund (AIF) — these are the main five players in the East Asia Pacific Region. Some projects are funded by a single MDB, some projects are co-funded by 2 or more MDBs. It's not uncommon to have 4 MDBs each financing parts of a major project.

- As an example, the project we've talked about with you so far is the Indonesia Health System Strengthening Project. For context, the total budget for this project is $4 billion and is looking to redesign all aspects of the entire Health Service. The World Bank contribution is $1.5b, Asian Development Bank is contributing $650m, Islamic Development Bank is contributing $846 million, Asian Infrastructure Investment Bank is contributing $1 billion. The Indonesian government is making up the rest. It's for a total overhaul of the health system across Indonesia — spanning all 38 provinces, 514 districts/cities and upgrades to over 300,000 health facilities (including over 500 hospitals). It's the biggest project the World Bank has ever done in Health. It's also the biggest they've ever done in Indonesia (and possibly EAP).

- The Implementing Agency — in this project's case being the Indonesia Ministry of Health — is responsible for procuring the necessary Goods, Contract Works, Consulting Services, Non-consulting Services to complete this project.

- As part of this obligation, the Implementing Agency needs to Create, Assess (and compare) and/or Validate key documents along the way. Examples include:
  - At the beginning of a project they may need to create (or validate) a Terms of Reference document. This document would typically be sent to the MDB they're working with to get it signed off to make sure it meets all policies/guidelines the Implementing Agency needs to follow to secure the money.
  - Similarly, the Implementing Agency may need to create (or validate) an RFP (sometimes called a Bid document) before it is put out to market, for Vendors to send in responses. Again, the Implementing Agency will need to send this to the relevant MDB to get it signed off to make sure it meets all policies/guidelines the Implementing Agency needs to follow to secure the money.
  - Once the Implementing Agency receives responses from vendors for the RFP/Bid, they need to look through each application thoroughly and determine which ones are suitable. The aim is to whittle down to a vendor to move forward with. It's important to note that this is often a 2-stage process where the first stage is about reviewing the applications.

# Technical Response from the vendors (without financial information) to see who meets the requirements. The second stage is then reviewing the financial information to make a final decision. This leads to the next bullet point.

> Once the Implementing Agency has been through stage 1 (Technical review), they need to write up their decision(s) and send this to the MDB and get sign off that they've met all the requirements set out in various policies and guidelines before they can move on to stage 2. Writing up the document at the end of stage 1 is called the Technical Evaluation Report (TER), writing up the document at the end of stage 2 is called the Combined Evaluation Report (CER). Again, the MDB has to sign off the CER before the Implementing Agency can move forward and notify the vendor of their success.

It's worth noting that some of these processes, particularly the back and forth between Implementing Agency and MDB, can take months to get signed off.

## Phase 1 Launch Requirements

### User Types and Roles

We believe there are three types of "User" needed for Nolia:

- **Super Admin:** The first user who has the ability to create new users. This Super Admin also has the same privileges as Admin and can perform all the same tasks. The only difference is that this account cannot be deleted.
- **Admin:** Has identical access to Super Admin (can see/do everything in the system) but can be deleted by Super Admin (or other Admin).
- **Operator:** Standard users who have less access than admin as they can't see the user management side and some aspects of what the system needs to function, but they do all the operational work.

### 1. System Deployment

We believe we're going to need to be ready to "deploy" a new/fresh instance on their (MoH) server. We have no idea what that means at the moment. You'll be looped in as soon as we have the relevant connections.

### 2. Super Admin Setup

The instance would need to come with a "super admin" role — the first user who has the ability to create new users. This Super Admin would also have the same privileges as Admin and be able to perform all the same tasks. The key difference is that this is the only account that cannot be deleted.

### 3. User Management Flow

Creating new users via User Management: The first task a Super Admin will want to do is set up new Admin and Operators.

# Process:

1. Click on "User Management" in navigation
2. Land on user management page — /borrowing-countries/user-management
3. Supply email address of person
4. Select Admin OR Operator from corresponding dropdown
5. Press "Send invites" button
6. Emails are sent out to that person using verification template — /borrowing-countries/user-management/verification (example only)
7. Recipient clicks on "Verify email"
8. User is taken to enter verification code page — /borrowing-countries/user-management/enter-code
9. Final step lands them on the login page /login — ready for them to sign in

# Role-based Access:

## Admin sees:

- Dashboard
- Knowledge Bases (Global, Project, Procurement Activity)
- Validate Documents
- User Management
- Own profile
- User Documentation (Admin version)

## Operator sees:

- Dashboard
- Validate Documents
- Own profile
- User Documentation (Operator version)

> Note: There might be a requirement to have further privileges/requirements of what the user (likely Operator only) can/cannot see based on procurement activity, but not for initial setup (just as intelligence for now).

## 4. Admin Dashboard and Navigation

When logging in, Admins see:

- Dashboard
- Knowledge Bases
- Validate Documents
- User Management
- Own profile
- User Documentation (Admin version)

## 5. Knowledge Base Setup

# Admins have the ability to set up knowledge bases. There are three types of knowledge bases that often get paired in other parts of the site — typically a Global knowledge base with either/or Project or Procurement Activity Knowledge Base.

## Navigation: Clicking on Knowledge Bases lands Admin on the Global page with ability to easily move to Project and Procurement Activities using button group (top right) — /borrowing-countries/bases/global

## Main page requirements:

- Display each knowledge base set up in that area (global, project, procurement activity)
- Ability to delete a knowledge base
- Ability to switch the knowledge base on/off (make active/deactivate). This action determines whether it shows in other areas of the site

## Knowledge Base Pairing Logic:

This section relates more to the other areas of this document but have put here so you understand why we need these three areas to be separate / distinct

1. Global + Procurement Activity for validating TERs and CERs (before the Create function is available)
2. Global + Procurement Activity for assessing and comparing Responses to bid documents
3. Global + Procurement Activity for creating TERs/CERs after an Assess/Compare responses process
4. Global + Project for Creation of ToRs or RFP/Bid documents

Other pairings likely needed but we're still getting our heads around them. From our understanding you'll need pair a Project knowledge base with a Procurement Activity knowledge base.

## Conflict Resolution: If there are conflicts between the Global knowledge base and the Procurement Activity knowledge base, the Procurement Activity knowledge base takes priority as it has the most up-to-date and procurement activity relevant information.

## Viewing a knowledge base:

From each knowledge base landing page you can click on a card to reveal more information about that particular knowledge base. For now we only need to show the documents that related to this knowledge base — (as example only) /borrowing-countries/bases/global/knowledge-base?baseId=789befa3-1d17-4a40-a101-a36e3cdfaf0d

Down track we'll want to allow users to click on the rules button and see the rules that the system has created.

## Creating new knowledge bases

There are either 1 (Project), 2 (Global) or 3 (Procurement Activity) steps based on types of information required. The current system requires specific file types to be loaded. The steps help us understand the type of information being uploaded, with Output Templates being the most important. (Using Global as example /borrowing-countries/bases/global/create-new)

## 6. Document Validation (For Admin and Operator)

### Process Overview: Users have the ability to upload a document and have it assessed by the system so the Implementing Agency can see if the World Bank is likely to sign it off. The system provides a streamlined process to do this.

# comprehensive assessment of the document and what needs to be changed before sending it to the World Bank.

## For launch: We only need to worry about TERs and CERs. We imagine ToRs and RFPs will need to come soon after.

## Document Upload Flow:

1. User lands on validate documents page (can see list of previously validated documents) — / borrowing-countries/verify-documents
2. Can see previously uploaded/validated documents by clicking view icon. And, can download results as PDF (from the individual assessment page) — example page / borrowing-countries/verify-documents/b8e4d0c3-5f72-4e90-0d4g-3f9b7e2c6p58
3. Click "Upload document" to start new validation assessment — /borrowing-countries/verify-documents/document-upload
4. Selection process:
   - Select Global knowledge base (initial list will only be Evaluation Report TER and Evaluation Report CER drawn from active Global knowledge bases — /borrowing-countries/bases/global)
   - Once Global is selected, new dropdown appears asking "Select the Procurement Activity to assess against" (list of active Procurement Activities — /borrowing-countries/bases/procurement-activity)
   - Selecting a Procurement Activity adds another dropdown asking "Select the language you'd like the output" (English and Bahasa options)
5. Upload document to start assessment process

## Important notes:

- The Procurement Activity Knowledge base takes priority over the Global if any conflict arises
- The Output Template (which should be determined by the Global knowledge base) determines how the output should be generated
- Assessment can take about 30 minutes - users see a spinning wheel showing current process step (or step process diagram)
- Users can close window and return later
- FYI — 99% of input documents (TERs and CERs) will be in English

## 7. User Profile Management

Users (whether Admin or Operator) have the ability to see and edit their own profile (only) — example page /borrowing-countries/user-management/olivia%40example.com

## 8. User Documentation

Users see their own version of the User Documentation. We'll use a paid user documentation system and populate it with content we're still to create.

# Phase 2 Requirements (Post-Launch Priority Order)

## 9. Assess & Compare RFP/Bid Responses

[Image: The document contains information about the comprehensive assessment of a document that needs to be made before sending it to the World Bank. It includes details on the document upload flow, user profile management, user documentation, and phase 2 requirements after launch.]

# Most important Phase 2 feature: Ability for Implementing agencies to assess the RFP/Bid responses they've received from Vendors.

## Process:

1. User sees list of procurement activities (active ones from Procurement Activity knowledge bases) — /borrowing-countries/procure/procure-activity?activityId=8641b9a0-1ff1-4ebc-90ba-7d9d4e663185
2. User selects the Procurement Activity to work on — e.g. looks like /borrowing-countries/procure/procurement-activity?activityId=8641b9a0-1ff1-4ebc-90ba-7d9d4e663185
3. Two states: Technical and Combined phases
   - Technical phase: First phase without financial information
   - Combined phase: Includes financial information
4. Upload Response process:
   - Use "Upload Response" button — depending on whether you're in "Technical" or "Combined" tab — e.g. /borrowing-countries/procure/upload-response?activityId=8641b9a0-1ff1-4ebc-90ba-7d9d4e663185
   - Fields auto-populate based on route
   - Upload document for assessment
   - Similar process/UI to TER/CER assessment
5. Each uploaded response gets listed on the procurement activity page either in "Technical" or "Combined" tab, depending on where you started the upload from
6. Important: No relationship needed between Technical and Combined pages initially

### 9b. Response Comparison

Next priority: Allow comparison of responses

- Select checkboxes of up to three responses
- Click Actions button and press "Compare Responses"
- If none selected, uses top 3 by score or prompt user to choose up to 3
- Output shows pros/cons of selected suppliers
- Important: System is NOT allowed to give opinions - only surfaces important information

### 10. Document Creation

Next focus would be the Create document section, starting with scoping the ease of creating either a ToR or RFP/Bid document, or creating a TER/CER.

### 11. Analytics & Insights

Finally, the Analytics & Insight section would show:

- Predetermined graphs using site data
- Natural language chat box to question information housed in the system

## System Vision

In essence, we're creating a system for the Implementing agency to manage key parts of the procurement process, especially in relationship to the various MDBs they interact with.

# Long-term goals:

Ideally, to lock in the customer (Implementing Agency) where the value is too good to leave we want these elements to be true. This list is in order of flow not order of importance/value to customer.

1. **Document Creation**: The ability for the Implementing Agency to create a compliant document such as a ToR and/or RFP/Bid document that the MDB is happy to sign off because it's been written by Nolia and ticks all the boxes.

2. **Response Assessment**: Once the RFP/Bid doc is in the marketplace, the Implementing agency will receive responses and need to assess and compare them to help make quick decisions.

3. **Compliance Documentation**: As they make selection decisions, Nolia helps them write compliant TER/CER documents to send to the MDB for sign off.

Everything else is supporting functionality for these core capabilities.
