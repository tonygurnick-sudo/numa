# Integration Connector Analysis

## Authentication Categories Summary

### **OAuth 2.0 / Modern Auth** ✅ (Easiest Integration)

- **Wrike** - OAuth 2.0 with secure token management
- **Total Synergy** - OAuth 2.0 + API keys
- **Podio** - OAuth 2.0
- **WorkflowMax** - OAuth 2.0

### **API Key / Token Auth** 🟡 (Moderate Complexity)

- **HireHop** - API token authentication
- **Connecteam** - API keys through General Settings
- **SiteApp Pro** - Custom API with authentication
- **Workbench International Ltd** - Bearer token authentication

### **Custom Authentication** 🟠 (Platform-Specific)

- **PrintIQ** - Instance URL + username + password + application name + application key
- **FileMaker** - FileMaker Data API authentication

### **Integration Platform Dependent** 🔵 (Via Third-Party)

- **Fergus** - Zapier integration (no direct REST API)
- **simPRO** - GitHub docs available, marketplace integrations

### **Enterprise/Partner Only APIs** 🔴 (High Barrier)

- **Sistemi S.p.A.** - Enterprise-only integrations
- **Abel Software** - Direct contact required
- **Rave Build** - No public API documentation
- **MyHub Intranet** - API mentioned but not documented
- **ECI Solutions** - Authentication method not specified

### **No Public API Available** ⚫ (Cannot Integrate)

- **Geroc Solutions** - SQL Server backend, no REST layer
- **Tablogs** - No public API documentation found

### **Unclear/Unspecified Authentication** ❓ (Requires Research)

- **RosterElf** - Has integrations but API docs unclear
- **BuilderTrend** - API mentioned but auth method not specified

## Integration Priority by Authentication

### **Immediate Integration Candidates (OAuth 2.0):**

1. Wrike
2. Total Synergy
3. Podio
4. WorkflowMax

### **Secondary Targets (API Keys/Tokens):**

5. HireHop
6. Connecteam
7. Workbench International Ltd
8. SiteApp Pro

### **Requires Custom Implementation:**

9. PrintIQ
10. FileMaker

### **Third-Party Platform Route:**

11. Fergus (via Zapier)
12. simPRO (via marketplace)

---

## Authentication Methods & Integration Analysis

### **OAuth 2.0 / Modern Auth (Easiest Integration)**

- **Wrike**: OAuth 2.0, comprehensive REST API, webhooks, SDKs available
- **Total Synergy**: OAuth 2.0 + API keys, well-documented, already integrates with accounting platforms
- **Podio**: OAuth 2.0, mature API used by their own frontend
- **WorkflowMax**: OAuth 2.0, REST + GraphQL, webhooks support

### **API Key / Token Auth (Moderate Complexity)**

- **HireHop**: API token auth, rate limited (60/min), good docs
- **Connecteam**: API keys through General Settings (Expert plan required)
- **SiteApp Pro**: Custom API with authentication (specifics unclear)

### **Integration Platform Dependent**

- **Fergus**: Primary integration via Zapier (no direct REST API publicly available)
- **RosterElf**: Has Xero/MYOB integrations but API docs unclear
- **PrintIQ**: Custom auth with instance URL + credentials

### **Enterprise/Partner Only APIs**

- **Sistemi S.p.A.**: Enterprise-only integrations
- **Abel Software**: Requires direct contact for API access
- **Geroc Solutions**: SQL Server backend, no public API
- **Rave Build**: No public API documentation
- **MyHub Intranet**: API mentioned but not documented

### **Enhanced Database APIs**

- **FileMaker**: FileMaker Data API with REST, enhanced in 2024/2025
- **simPRO**: GitHub docs available, marketplace integrations

## Integration Challenges by System

### **High Complexity/Risk**

1. **Tablogs** - No public APIs, recent platform (2018), limited integration history
2. **Geroc Solutions** - SQL Server direct access required, no REST layer
3. **Abel Software** - Architecture unclear, requires extensive discovery
4. **Sistemi S.p.A.** - Italian platform, enterprise sales process required

### **Medium Complexity**

1. **RosterElf** - Australian compliance focus, existing payroll integrations suggest capability
2. **BuilderTrend** - Construction-specific, acts as "translator" between systems
3. **Fergus** - Zapier-dependent, limited direct API access
4. **FileMaker** - Requires FileMaker platform knowledge

### **Lower Complexity (Good Documentation/Standards)**

1. **Wrike** - Enterprise-grade, comprehensive docs, SDK support
2. **Total Synergy** - Already proven with accounting integrations
3. **HireHop** - Clear rate limits and documentation
4. **Podio** - Battle-tested API (their frontend uses it)

## Likely Interaction Patterns for Numa

### **Workforce Management Systems** (RosterElf, Connecteam, Fergus)

- **UX Pattern**: Employee scheduling, time tracking, compliance reporting
- **Numa Integration**: Chat queries about schedules, automated compliance checks, roster optimization
- **Data Flow**: Read schedules/timesheets → AI analysis → Recommendations

### **Project Management** (Wrike, Podio, WorkflowMax, simPRO)

- **UX Pattern**: Task management, project dashboards, resource allocation
- **Numa Integration**: Project status updates, automated reporting, resource optimization
- **Data Flow**: Bidirectional sync of tasks, automated status updates via chat

### **Specialized Industry** (Tablogs, Geroc Solutions, SiteApp Pro)

- **UX Pattern**: Technical data collection, compliance reporting, specialized workflows
- **Numa Integration**: Data analysis, automated report generation, compliance monitoring
- **Data Flow**: Import technical data → AI analysis → Formatted reports

### **ERP/Accounting** (Total Synergy, Sistemi, Abel Software)

- **UX Pattern**: Financial reporting, inventory management, business intelligence
- **Numa Integration**: Financial analysis, automated invoicing, budget optimization
- **Data Flow**: Read financial data → AI insights → Recommendations/actions

## Recommended Integration Priority

### **Tier 1: Start Here** (Proven APIs, Good ROI)

1. **Wrike** - Mature platform, excellent docs, broad appeal
2. **Total Synergy** - Already proven integrations, Australian market
3. **Podio** - Flexible platform, reliable API

### **Tier 2: High Value, Medium Effort**

1. **HireHop** - Equipment rental niche, clear API boundaries
2. **WorkflowMax** - Service business focus, comprehensive API
3. **SiteApp Pro** - Safety compliance niche, existing integrations

### **Tier 3: Specialized/Higher Risk**

1. **RosterElf** - Australian workforce compliance (if targeting AU market)
2. **Fergus** - Via Zapier integration path
3. **PrintIQ** - Specialized print industry

## Key Insights

The best combination for initial integration targets:

- **Modern authentication** (OAuth 2.0 preferred)
- **Comprehensive documentation**
- **Proven integration history**
- **Broad market appeal**
- **Lower technical risk**

**Wrike, Total Synergy, and Podio** offer the optimal balance of these factors for successful integration into the Numa platform.

## Detailed Platform Information

### RosterElf

- **URL**: https://docs.integration.wfs.cloud/
- **Overview**: Australia-based employee rostering and HR software serving 30,000+ workplaces
- **Key Capabilities**:
  - Existing integrations with Xero and MYOB payroll systems via direct API sync
  - Mobile apps (iOS/Android) with real-time data connectivity
  - GPS/geofencing time tracking with photo verification
  - Automated Fair Work compliance and award rate calculations
  - Multi-site management with unified calendar views
  - Auto-scheduling with AI-driven shift assignment
  - Real-time labour cost tracking and budget controls
- **Target Industries**: hospitality, healthcare, retail, childcare
- **Integration Notes**: Strong focus on shift-based businesses and Australian workplace law compliance

### Workbench International Ltd

- **URL**: https://webwbdoc.atlassian.net/wiki/spaces/WAPI/pages/2973007946/Overview
- **API Details**: Robust REST API with JSON over HTTP, OpenAPI/Swagger documentation, supports CRUD operations, paginated list endpoints, Bearer token authentication, NSwag client generation, Postman collections available
- **Technology**: Built on Microsoft stack (ASP.NET, SQL Server) with SOA architecture
- **Updated**: January 2024

### Sistemi S.p.A.

- **Overview**: Cloud-based software solutions including PROFIS (accounting/fiscal), STUDIO (legal practice), JOB (HR/payroll), PEOPLELINK (HRM), ESOLVER (ERP), and industry-specific solutions for manufacturing, distribution, and agriculture
- **Platform**: Browser-based and cloud-accessible
- **API Status**: Documentation not readily available - likely enterprise/partner-only integrations

### HireHop

- **URL**: https://www.hirehop.com/api_documentation/
- **API Details**: REST API v1.0 with comprehensive endpoints for managing jobs, inventory, contacts, projects, purchase orders, and time tracking
- **Rate Limits**: 60 requests/minute, 3/second
- **Features**: Pagination support, custom fields access, ISO 8601 date formats, multiple domain access
- **Authentication**: API tokens
- **Focus**: Equipment rental management integration

### WorkflowMax

- **URL**: https://api-docs.workflowmax.com/
- **API Details**: Comprehensive API V2 with REST and GraphQL interfaces
- **Coverage**: Managing clients, jobs, tasks, timesheets, invoices, purchase orders
- **Features**: Webhooks, custom objects, pagination, SDKs, sample code
- **Customer Base**: Over 10,000 customers in service-based businesses

### Podio

- **URL**: https://developers.podio.com/
- **API Details**: Robust REST API with comprehensive documentation
- **Access**: Workspaces, apps, tasks, calendars, and all core Podio functionality
- **Features**: Webhooks, client libraries for multiple languages, rate limiting with ability to increase limits
- **Architecture**: The entire Podio frontend is built on this API

### simPRO Group

- **URL**: https://github.com/jezweb/simpro-api-docs
- **Integration Platform**: Marketplace (https://marketplace.simprogroup.com/) with extensive pre-built integrations
- **Categories**: Accounting, CRM, e-commerce, supplier management
- **Features**: Automated workflows, data synchronization, custom integrations
- **Focus**: AI-driven workflow optimization and IoT integration for field service management

### BuilderTrend

- **URL**: https://buildertrend.com/blog/blog-construction-api/
- **API Role**: Acts as a "translator" to facilitate data exchange between their platform and other business applications
- **Integrations**: Over 1,000 integrations including QuickBooks, Salesforce, Microsoft 365
- **Features**: Real-time data sharing, workflow automation, custom application development
- **Data Types**: Project data, financial information, customer data across construction workflows

### Abel Software

- **Overview**: Comprehensive ERP (Enterprise Resource Planning) system with multi-layered architecture
- **Features**: Unique Application Engine enabling workflow automation and cross-functional integration
- **Deployment**: Flexible options (on-premises or cloud) with scalable architecture
- **API Status**: Specific documentation needs research through direct contact

### Geroc Solutions

- **Product**: CORE-GS integrated project data management and reporting system for engineering teams
- **Database**: Microsoft SQL Server backend
- **Features**: Collaboration, GIS integration, automation, security, mobile data capture
- **Add-ins**: SYNC (field/office sync), ADT (automated reports), CPT (cone penetration test data), AUTO (process automation)
- **Established**: 2010

### Connecteam

- **URL**: https://developer.connecteam.com/docs/introduction-1
- **API Access**: Available for Expert plan accounts
- **Documentation**: Comprehensive center with endpoints, parameters, data models, guides, tutorials, code snippets
- **Features**: Discussion board, changelog, flexible schema validation
- **Management**: API keys through General Settings

### Tablogs

- **Overview**: Cloud-based geotechnical data collection and reporting platform
- **Established**: 2018, Brisbane Australia
- **User Base**: Over 10,000 users in 20+ countries
- **Products**: TabLogs (field data capture, borehole logging, report generation) and TabLabs (LIMS for materials testing)
- **Recent Features**: CAD integration
- **API Status**: No public API docs found

### Fergus

- **URL**: https://help.fergus.com/en/articles/11644092-zapier-integration
- **Integration Method**: New open API integrated with Zapier
- **Zapier Access**: 8,000+ apps (Google Sheets, HubSpot, MailChimp, Slack, Typeform)
- **Workflow Role**: Can act as both trigger and action in Zapier workflows
- **Direct Integrations**: Accounting software (Xero, QuickBooks, MYOB), 100+ trade suppliers
- **API Status**: No standalone REST API documentation publicly available
- **Authentication**: Single sign-on with 2FA support

### SiteApp Pro

- **URL**: https://apidoc.siteapppro.co.nz/
- **Overview**: Health and safety management software with custom API
- **Integration Platform**: Zapier integration for workflow automation
- **Pre-built Integrations**: Procore, AuditSoft, Service M8, simPRO, Bullhorn
- **Features**: Digital forms, contractor management, equipment/asset tracking, safety intelligence dashboards, offline functionality
- **Location**: Based in Auckland, New Zealand with operations in US and Canada

### Total Synergy

- **URL**: https://developers.totalsynergy.com/
- **API Details**: Well-documented REST API with OAuth 2.0 and static API key authentication
- **Documentation**: Swagger UI available at developers.totalsynergy.com/swagger/ui/index
- **Rate Limits**:
  - Free tier: 300 API calls/day (50 to Transactions API)
  - Premium tier: 60,000 calls/day (20,000 to Transactions API)
- **Base URL**: api.totalsynergy.com/api/v2/
- **Features**: CRUD operations with pagination up to 1,000 records per request
- **Existing Integrations**: Xero, MYOB, QuickBooks, Wiise accounting platforms

### Rave Build

- **API Status**: No public API documentation found
- **Platform**: Cloud-based SaaS with Xero integration
- **Partner Program**: Rave Partners Program (specifics not disclosed)
- **Assessment**: Direct contact needed for integration capabilities

### Claris FileMaker

- **URL**: https://help.claris.com/en/data-api-guide/
- **API**: FileMaker Data API (FM DAPI) significantly enhanced in FileMaker 2024 (v21) and 2025
- **Enhancements**:
  - RESTful Integration: Full REST endpoints and cURL support with CRUD operations
  - Usage limits removed in FileMaker 2024 enabling scalable enterprise use
  - JSON and JavaScript support for modern tech stack integration
  - AES-256 encryption, SSL/TLS 1.2, SOC 2® Type 2 and ISO/IEC 27001 compliance
  - Enhanced validation and error handling
  - AI integration features in FileMaker 2025 for data insights

### PrintIQ

- **URL**: https://printiq.com/iqconnect-api/
- **API Module**: IQconnect-API providing comprehensive APIs exposing key workflows
- **Integration Categories**:
  1. **Integrate**: CRMs (HubSpot, Zoho), EDM tools, customer databases with real-time updates and Zapier compatibility
  2. **Link**: Connects to other PrintIQ systems, enables real-time pricing and quote generation
  3. **Punch-Out**: E-commerce integration, automates order transfer from third-party platforms
  4. **SmartSite**: Converts SEO websites into e-commerce platforms with self-contained widgets
- **Authentication**: Requires instance URL, username, password, application name, and application key
- **Features**: Real-time inventory levels, order status updates, tracking number integration
- **Existing Integrations**: Infigo and other print management platforms

### Wrike

- **URL**: https://developers.wrike.com/
- **API Version**: RESTful API v4 with comprehensive capabilities
- **Authentication**: OAuth 2.0 with secure token management
- **Coverage**: Tasks, projects, contacts, timelines, custom data
- **SDKs**: Multi-language support (Node.js, Python, Ruby, PHP, Java, C#, Go)
- **Features**:
  - Webhooks for real-time event notifications
  - API Explorer and Postman collections
  - Sandbox environment for testing
  - Rate limiting and error handling guidelines
- **Company**: 20,000+ customers, recognized as 2025 Gartner® Magic Quadrant™ Leader
- **Recent Acquisition**: Klaxoon (visual collaboration platform)

### MyHub Intranet

- **Overview**: AI-powered, all-in-one intranet platform for employee communication, knowledge management, and learning
- **Features**: AI-assisted content creation, embedded LMS, digital forms, QA tools, mobile sync, Canva integration, third-party app connectivity
- **API Status**: Integration capabilities mentioned but documentation not publicly available

### ECI Solutions - Manufacturing ERP

- **Overview**: API integration capabilities for M1 ERP and JobBOSS² platforms
- **API Features**: CRUD operations, real-time data synchronization, RESTful architecture
- **Integration Areas**: CAD/CAM systems, shop-floor equipment monitoring, supply chain management, compliance reporting
- **Focus**: Discrete manufacturing and project-centric workflows
