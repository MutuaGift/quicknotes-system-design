# QuickNotes API Design

This is the API the **real** QuickNotes backend should expose. It is not the
JSONPlaceholder practice API used by the front end in `api.js`; this is the
service the backend team will build.

QuickNotes is a note-taking service. Users sign up, write notes, read their own
notes back, organise them with tags, and can share a note with another user.

---

## Conventions

- **Base URL:** `https://api.quicknotes.example.com/v1`
- **Format:** JSON in both directions. Requests send `Content-Type: application/json`.
- **Authentication:** a bearer token in the `Authorization` header:
  `Authorization: Bearer <token>`
- **Identifiers:** integers. A note is `/notes/{note_id}`, not `/notes/{title}`.
- **Timestamps:** ISO 8601 in UTC, e.g. `2026-10-15T09:30:00Z`.

### The note resource

```json
{
  "id": 42,
  "title": "Pack for Monday",
  "body": "Keys, badge, laptop charger.",
  "user_id": 7,
  "is_public": false,
  "created_at": "2026-10-15T09:30:00Z",
  "updated_at": "2026-10-15T09:30:00Z",
  "tags": ["travel", "personal"]
}
```

---

## Endpoints

| # | Method | Path | Description | Success |
| --- | --- | --- | --- | --- |
| 1 | `GET` | `/notes` | List the signed-in user's notes | `200 OK` |
| 2 | `POST` | `/notes` | Create a note | `201 Created` |
| 3 | `GET` | `/notes/{note_id}` | Fetch one note | `200 OK` |
| 4 | `PATCH` | `/notes/{note_id}` | Partially update a note | `200 OK` |
| 5 | `DELETE` | `/notes/{note_id}` | Delete a note | `204 No Content` |
| 6 | `GET` | `/notes/{note_id}/tags` | List the tags on a note | `200 OK` |
| 7 | `POST` | `/notes/{note_id}/tags` | Add a tag to a note | `201 Created` |
| 8 | `DELETE` | `/notes/{note_id}/tags/{tag}` | Remove a tag from a note | `204 No Content` |
| 9 | `GET` | `/tags` | List the user's tags with note counts | `200 OK` |
| 10 | `GET` | `/users/{user_id}/notes` | List a user's public notes | `200 OK` |
| 11 | `POST` | `/users` | Register a new account | `201 Created` |
| 12 | `POST` | `/sessions` | Sign in and receive a token | `200 OK` |

### Endpoint detail

**1. `GET /notes`** — Returns the signed-in user's notes, newest first, filtered
and paged.
- Query: `page` (default 1), `limit` (default 20, max 100), `tag` (filter by one tag)
- Success: `200 OK`

**2. `POST /notes`** — Creates a note owned by the signed-in user. The server
assigns the `id` and timestamps. Validation lives here, not in the client.
- Success: `201 Created`, plus a `Location: /v1/notes/42` header

**3. `GET /notes/{note_id}`** — Returns one note. If it is private, only its owner
may read it, so a missing note and a forbidden one must not be distinguishable
to an outsider.
- Success: `200 OK`

**4. `PATCH /notes/{note_id}`** — Changes only the fields sent. `PATCH` rather
than `PUT` because a note is usually edited in one place, and a full `PUT`
would force the client to resend everything it did not mean to change.
- Success: `200 OK` with the updated note

**5. `DELETE /notes/{note_id}``** — Deletes a note. Returns no body.
- Success: `204 No Content`

**6. `GET /notes/{note_id}/tags`** — Lists the tags on a note. A nested
collection, because tags only exist in the context of a note.
- Success: `200 OK`

**7. `POST /notes/{note_id}/tags`** — Adds a tag, creating the tag if the user
does not already have one with that name.
- Success: `201 Created`

**8. `DELETE /notes/{note_id}/tags/{tag}`** — Removes one tag from a note. The
note itself is untouched.
- Success: `204 No Content`

**9. `GET /tags`** — Lists the user's tags with how many notes carry each, so the
sidebar can show counts without a query per tag.
- Success: `200 OK`

**10. `GET /users/{user_id}/notes`** — Lists another user's **public** notes. A
separate path from `/notes` because the point is that these belong to somebody
else and are filtered by privacy.
- Success: `200 OK`

**11. `POST /users`** — Registers an account. No token needed, since there is no
user yet.
- Success: `201 Created`

**12. `POST /sessions`** — Exchanges credentials for a token. A resource rather
than a `GET /login`, because logging in creates a token and a `GET` must never
change anything.
- Success: `200 OK`

---

## Request and response examples

### Creating a note — `POST /notes`

**Request**

```http
POST /v1/notes HTTP/1.1
Host: api.quicknotes.example.com
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json
```

```json
{
  "title": "Pack for Monday",
  "body": "Keys, badge, laptop charger.",
  "is_public": false,
  "tags": ["travel", "personal"]
}
```

**Response — `201 Created`**

```http
HTTP/1.1 201 Created
Location: /v1/notes/42
Content-Type: application/json
```

```json
{
  "id": 42,
  "title": "Pack for Monday",
  "body": "Keys, badge, laptop charger.",
  "user_id": 7,
  "is_public": false,
  "created_at": "2026-10-15T09:30:00Z",
  "updated_at": "2026-10-15T09:30:00Z",
  "tags": ["travel", "personal"]
}
```

The client sends `title`, `body`, `is_public` and `tags`; the server replies
with `id`, `user_id` and the timestamps as well. This is why the id is reported
to the user — `id` is the server's, not the client's, so the client cannot
invent one.

### Listing notes — `GET /notes?limit=2&page=1&tag=travel`

**Request**

```http
GET /v1/notes?limit=2&page=1&tag=travel HTTP/1.1
Host: api.quicknotes.example.com
Authorization: Bearer eyJhbGciOi...
```

No request body: this is a read.

**Response — `200 OK`**

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "page": 1,
  "limit": 2,
  "total": 14,
  "notes": [
    {
      "id": 42,
      "title": "Pack for Monday",
      "body": "Keys, badge, laptop charger.",
      "user_id": 7,
      "is_public": false,
      "created_at": "2026-10-15T09:30:00Z",
      "updated_at": "2026-10-15T09:30:00Z",
      "tags": ["travel", "personal"]
    },
    {
      "id": 39,
      "title": "Airport parking",
      "body": "Level 3, near the long-stay.",
      "user_id": 7,
      "is_public": false,
      "created_at": "2026-10-11T18:05:00Z",
      "updated_at": "2026-10-11T18:05:00Z",
      "tags": ["travel"]
    }
  ]
}
```

The envelope carries `page`, `limit` and `total` alongside `notes`, so a client
can draw a pager without a second request. Returning the total count on every
page is a deliberate trade-off: it costs an extra count query, and it saves the
client from guessing whether more pages exist.

---

## Error codes

Every error comes back in the **same shape**, so a client can handle them all
with one piece of code rather than guessing from the shape of each response.

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The title is required.",
    "field": "title",
    "request_id": "3f8a1c9e-2b44-4d17-9a10-77c2e5b1d0aa"
  }
}
```

| Status | Meaning | Example when it happens |
| --- | --- | --- |
| `400` | Bad Request | `POST /notes` with no `title`, or a title over 100 characters |
| `401` | Unauthorized | A request with no `Authorization` header, or an expired token |
| `403` | Forbidden | A valid token, but the note belongs to somebody else and is private |
| `404` | Not Found | `GET /notes/9999` when no note has that id |
| `409` | Conflict | Registering an email address that already has an account |
| `422` | Unprocessable | Well-formed JSON whose values cannot be processed |
| `429` | Too Many Requests | Rate limit exceeded; `Retry-After` says when to come back |
| `500` | Internal Server Error | An unhandled bug on the server |

### Worked examples

**`400 Bad Request`** — the request was understood but is invalid, and the client
must change something before retrying.

```http
POST /v1/notes
{ "body": "No title at all." }
```

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The title is required.",
    "field": "title",
    "request_id": "3f8a1c9e-2b44-4d17-9a10-77c2e5b1d0aa"
  }
}
```

**`401 Unauthorized`** — who is calling is unknown. No token, or a token that has
expired or been revoked.

```http
GET /v1/notes
(no Authorization header)
```

```json
{
  "error": {
    "code": "unauthenticated",
    "message": "A bearer token is required.",
    "request_id": "9b3d2f10-6c81-4e55-a7b2-1180c4e5f3b2"
  }
}
```

**`403 Forbidden`** — the caller is known, but is not allowed. The note exists
and they may not have it.

```http
GET /v1/notes/42   (token belongs to user 9, note 42 belongs to user 7 and is private)
```

```json
{
  "error": {
    "code": "forbidden",
    "message": "You do not have access to this note.",
    "request_id": "c47e0a92-8f13-42d6-b5e9-0a7f3d2e6b51"
  }
}
```

**`404 Not Found`** — there is no resource at that address. Nothing was changed.

```http
GET /v1/notes/9999
```

```json
{
  "error": {
    "code": "not_found",
    "message": "No note was found with id 9999.",
    "request_id": "e5b7d3a4-1f60-4c92-8b3e-77a1c9f0d2e6"
  }
}
```

**`500 Internal Server Error`** — the server broke. The client should not retry
immediately and should not assume anything about the request.

```http
GET /v1/notes
```

```json
{
  "error": {
    "code": "internal_error",
    "message": "Something went wrong on our side.",
    "request_id": "aa11bb22-cc33-4d44-8e55-ff6677889900"
  }
}
```

### Why `403` and `404` are both needed

They are easy to confuse, and the distinction matters:

- **`403`** means the server knows exactly which note you asked for and has
  decided you may not have it. Use it when the caller is already known and the
  resource is real.
- **`404`** means there is nothing at that address at all.

`404` is the safer default for private notes, because a `403` confirms that the
note exists. A response that says "that note exists but is not yours" lets
somebody probe ids and map out other people's notes. So on a private note that
the caller does not own, this design returns **`404`, not `403`** — and reserves
`403` for cases where confirming existence is harmless, such as attempting to
change a shared note the caller can read but not edit.

---

## Design notes

- **Nouns in the paths, verbs in the method.** `/notes` stays `/notes` whether
  you are reading, creating or deleting; the method supplies the action.
- **`GET` never changes anything**, so it is safe to cache and safe to retry.
- **One status per outcome.** `200` for a read or an update, `201` for something
  newly created, `204` for a delete with nothing to return, `400` for a fixable
  mistake, `401`/`403`/`404` for who may see what.
- **`PATCH` rather than `PUT` for edits**, because a client editing one field
  should not be forced to send the whole note.
- **`POST /sessions` rather than `GET /login`**, because signing in creates
  something — a token — and a `GET` is not allowed to do that.
- **`request_id` in every error**, so a user can quote it and support can find
  the exact request in the logs.
