# Rentman Integration

## Critical: Pre-Built Actions Are Broken -- Use `numa integrations request`

The Rentman Pipedream actions (`rentman-find-item`, `rentman-create-item`, `rentman-update-item`) all use `reloadProps: true` on the `itemType` prop. The dynamic properties (item ID for find/update, field data for create) only load in Pipedream's UI workflow builder -- they **cannot be passed or discovered via the API**.

- `rentman-create-item` -- runs but creates blank records with default values, ignoring all field props
- `rentman-find-item` -- always fails with `[400] Invalid id in path`
- `rentman-update-item` -- same failure as find-item

**Always use `numa integrations request` (the proxy) for all Rentman operations.** The Rentman REST API is straightforward and works correctly via the proxy.

## API Base URL and Auth

- **Base URL:** `https://api.rentman.net`
- **Integration slug:** `rentman`
- **Auth type:** API key (Bearer token, injected automatically by the proxy)

## `numa integrations request` Examples

### List items (with pagination)

```bash
numa integrations request rentman GET "https://api.rentman.net/contacts?limit=50&sort=-id" \
  -m "Listing Rentman contacts"
```

Use `?limit=N&offset=N` for pagination. Use `?sort=-id` for newest first.

### Get item by ID

```bash
numa integrations request rentman GET "https://api.rentman.net/contacts/3657" \
  -m "Fetching Rentman contact 3657"
```

### Create item

```bash
numa integrations request rentman POST "https://api.rentman.net/contacts" \
  --body '{"name":"Acme Corp","type":"company","email_1":"info@acme.com"}' \
  -m "Creating Rentman contact"
```

### Update item

```bash
numa integrations request rentman PATCH "https://api.rentman.net/contacts/3657" \
  --body '{"name":"Updated Name","phone_1":"+64 9 000 0000"}' \
  -m "Updating Rentman contact 3657"
```

### Delete item

```bash
numa integrations request rentman DELETE "https://api.rentman.net/contacts/3657" \
  -m "Deleting Rentman contact 3657"
```

DELETE returns null (HTTP 204) on success.

## Critical: Reference Fields Use Resource Paths, Not Plain Values

Rentman uses resource paths (not IDs or names) for all relational fields. Passing a plain string or numeric ID will return a 400 error.

**Wrong:**

```json
{ "project_type": "AV Media Dry Hire", "customer": 3658 }
```

**Correct:**

```json
{ "project_type": "/projecttypes/115", "customer": "/contacts/3658", "location": "/contacts/3772" }
```

**Before creating or updating a record with reference fields, always look up the correct resource path first.** For example, to find the right `project_type` value, GET `/projecttypes` and use the path from the response (e.g., `"/projecttypes/115"`). Similarly, GET `/contacts` to find customer/location paths.

Common reference fields on projects: `project_type`, `customer`, `location`, `loc_contact`, `cust_contact`, `account_manager`.

## Other Field Gotchas

- **`displayname` is read-only** -- POST/PATCH with `displayname` returns `[400] You are not permitted to set the following field: displayname`. Use the `name` field instead (Rentman computes `displayname` from `name`).
- **Contact fields:** `name` (display name), `type` ("company" or "person"), `email_1`, `email_2`, `phone_1`, `phone_2`, `code` (auto-assigned), `mailing_city`, `mailing_street`, `mailing_country`.
- **Many fields are silently ignored on POST** -- always GET an existing record first to see which fields are actually returned and writable.

## Known Broken Endpoints (Rentman API Gateway Bug)

Certain Rentman endpoints have AWS API Gateway IAM auth misconfigured, rejecting valid Bearer tokens with `403 IncompleteSignatureException`. This is a Rentman-side bug affecting all API users, not specific to Numa.

**Broken endpoints:**

- `GET /me` -- 403
- `GET /locations` -- 403
- `PATCH /projects/{id}` -- 403
- `DELETE /projects/{id}` -- 403

**Working endpoints:** `GET/POST /contacts`, `DELETE /contacts/{id}`, `GET/POST /projects`, `GET /equipment`, `GET /crew`, `GET /subprojects`, and most other list/create endpoints.

If you hit a 403 with message containing "Invalid key=value pair (missing equal-sign) in Authorization header", this is the Rentman bug -- do not retry, inform the user that this specific endpoint/method is currently broken on Rentman's side.

## Response Structure

Single item:

```json
{"data": {"id": 3657, "displayname": "Acme Corp", ...}}
```

List:

```json
{"data": [...], "itemCount": 120, "limit": 50, "offset": 0}
```

## Common Resource Endpoints

| Resource         | Endpoint           | Notes                        |
| ---------------- | ------------------ | ---------------------------- |
| Contacts         | `/contacts`        | Customers, suppliers, venues |
| Contact Persons  | `/contactpersons`  | People within contact orgs   |
| Projects         | `/projects`        | Events, jobs, bookings       |
| Project Types    | `/projecttypes`    | Categories for projects      |
| Equipment        | `/equipment`       | Inventory items              |
| Crew             | `/crew`            | Staff/freelancers            |
| Subprojects      | `/subprojects`     | Project sub-sections         |
| Appointments     | `/appointments`    | Scheduled events             |
| Project Requests | `/projectrequests` | Equipment rental requests    |
