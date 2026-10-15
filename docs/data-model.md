# QuickNotes Data Model

The data behind QuickNotes: the **users** who write notes, the **notes**
themselves, the **tags** used to organise them, and **note_tags**, the table
that links a note to a tag.

All the SQL in this document has been run against SQLite, and the queries at the
end return the results shown.

---

## The entities

### `users`

One row per person with an account.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `user_id` | `INTEGER` | **PRIMARY KEY** | Surrogate key, never reused |
| `email` | `TEXT` | `NOT NULL`, **UNIQUE** | The login handle |
| `password_hash` | `TEXT` | `NOT NULL` | The hash, never the password |
| `display_name` | `TEXT` | `NOT NULL` | Shown on shared notes |
| `created_at` | `TEXT` | `NOT NULL` | ISO 8601 UTC |

### `notes`

One row per note.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `note_id` | `INTEGER` | **PRIMARY KEY** | Surrogate key |
| `user_id` | `INTEGER` | `NOT NULL`, **FK → `users.user_id`** | The owner |
| `title` | `TEXT` | `NOT NULL` | Max 100 characters, checked in the app |
| `body` | `TEXT` | nullable | Optional, so it is allowed to be empty |
| `is_public` | `INTEGER` | `NOT NULL`, `DEFAULT 0` | 0 private, 1 public |
| `created_at` | `TEXT` | `NOT NULL` | |
| `updated_at` | `TEXT` | `NOT NULL` | Bumped by `PATCH` |

### `tags`

One row per tag name, per user. A user called `travel` and another user called
`travel` are two different rows, because they belong to two different people.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `tag_id` | `INTEGER` | **PRIMARY KEY** | |
| `user_id` | `INTEGER` | `NOT NULL`, **FK → `users.user_id`** | Tags belong to one user |
| `name` | `TEXT` | `NOT NULL` | Case-insensitively unique per user |

### `note_tags`

The join table. One row per note-and-tag pairing.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `note_id` | `INTEGER` | **NOT NULL**, **FK → `notes.note_id`** | |
| `tag_id` | `INTEGER` | `NOT NULL`, **FK → `tags.tag_id`** | |

---

## Relationships

### `users` → `notes`: one-to-many

One user can write many notes; each note has exactly one author. Ten notes by one
person are ten rows in `notes` all pointing at the same `user_id`, not ten copies
of the user's details. `notes.user_id` is the foreign key that enforces it, and
the user row is never repeated, so correcting a display name updates one place.

### `notes` ↔ `tags`: many-to-many, which is why `note_tags` exists

A note can carry several tags, and a tag can sit on many notes. `travel` appears
on 30 different notes, and note 42 might be tagged `travel`, `personal` and
`urgent` at once.

Neither side can hold that fact alone. A column on `notes` can only point at one
tag, so a note with three tags would need three columns and a rule about which
one held the third. A comma-separated list does not fix it either: nothing can
check that each name exists, nothing prevents duplicates, and searching it means
string matching instead of an index.

So the relationship gets its own table. `note_tags` holds nothing but the two
keys, and that is exactly what makes it useful: it is a place to put rules and
to look things up from either end. Its composite primary key `(note_id, tag_id)`
stops the same tag being added to the same note twice, which is the rule the
business actually cares about — the note cannot be "tagged travel" once and
"tagged travel again".

This is the standard **join table** (or associative table) pattern for a genuine
many-to-many. It is used here instead of a JSON array of tag names on the note,
even though SQLite could store one, because the array version cannot enforce the
duplicate rule and cannot answer "all notes tagged travel" without scanning and
parsing every row.

### `users` → `tags`: one-to-many

One user can create many tags, and each tag belongs to one user. This is why
"travel" is unique per user rather than globally: a shared tag table would force
users to agree on vocabulary and would let one user see another's tag names.

---

## CREATE TABLE statements

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  user_id       INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);

CREATE TABLE notes (
  note_id    INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT,
  is_public  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (user_id)
);

CREATE TABLE tags (
  tag_id   INTEGER PRIMARY KEY,
  user_id  INTEGER NOT NULL,
  name     TEXT    NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (user_id),
  -- the same tag name cannot be created twice by one user
  UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
  note_id INTEGER NOT NULL,
  tag_id  INTEGER NOT NULL,
  -- together these are the primary key, which is also the
  -- rule that a tag cannot be added to a note twice
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes (note_id),
  FOREIGN KEY (tag_id)  REFERENCES tags (tag_id)
);
```

`PRAGMA foreign_keys = ON` is not optional decoration. SQLite ignores foreign
keys unless it is set, and the setting resets on every connection, so it belongs
at the top of the script. Without it the clauses are parsed and then never
checked, and the database will happily accept a note belonging to a user who
does not exist.

---

## Example queries

### 1. List a user's notes, newest first — a JOIN

```sql
SELECT n.note_id, n.title, n.updated_at
FROM notes AS n
JOIN users AS u ON n.user_id = u.user_id
WHERE u.email = 'amina@example.com'
ORDER BY n.updated_at DESC;
```

`note_id | title                 | updated_at`
`--------+-----------------------+--------------------------`
`3       | Pack for Monday       | 2026-10-15T09:30:00Z`
`2       | Airport parking       | 2026-10-11T18:05:00Z`
`1       | Reading list          | 2026-10-02T20:15:00Z`

The `JOIN` is what connects the notes to the person who wrote them, because the
email lives in `users` and the notes live in `notes`.

### 2. Every note carrying a given tag — two JOINs

This is the query the join table exists to make easy. It hops
`tags` → `note_tags` → `notes` → `users`.

```sql
SELECT u.display_name, n.title
FROM note_tags AS nt
JOIN tags   AS t ON nt.tag_id  = t.tag_id
JOIN notes  AS n ON nt.note_id = n.note_id
JOIN users  AS u ON n.user_id  = u.user_id
WHERE t.name = 'travel';
```

`display_name | title`
`-------------+------------------`
`Amina Hassan | Airport parking`
`Amina Hassan | Pack for Monday`

### 3. How many notes each user has — a JOIN with GROUP BY

```sql
SELECT u.display_name, COUNT(n.note_id) AS note_count
FROM users AS u
LEFT JOIN notes AS n ON n.user_id = u.user_id
GROUP BY u.user_id, u.display_name
ORDER BY note_count DESC;
```

`display_name | note_count`
`-------------+------------`
`Amina Hassan | 3`
`Ben Carter   | 1`
`Dana Fields  | 0`

`LEFT JOIN` rather than `JOIN` so that Dana, who has written nothing, still
appears with a count of 0. A plain `JOIN` would drop her, which is the wrong
answer to "how many notes does each user have".

### 4. Delete a note and everything pointing at it

```sql
DELETE FROM note_tags WHERE note_id = 3;
DELETE FROM notes      WHERE note_id = 3;
```

Two statements because SQLite will not cascade by itself unless the tables say
so. Deleting the `note_tags` rows first is not optional housekeeping: leaving
them behind would leave rows pointing at a note that no longer exists.

---

## An index worth adding

```sql
CREATE INDEX idx_notes_user_updated ON notes (user_id, updated_at DESC);
```

The single most common query in the app is "show my notes, newest first" —
query 1 above. Without an index SQLite scans the whole `notes` table and sorts
the result, which is fine at 100 rows and painful at 100 million.

Two columns, in this order, for two reasons. It leads with `user_id` because
every query filters on the user first, and an index can only be used for a
search that starts with its leading column. It then has `updated_at` because
once the `user_id` is fixed, the rows for that user are already in
newest-first order, so the `ORDER BY` is satisfied straight from the index
instead of a separate sort.

On the other two tables:

- `tags` already has a `UNIQUE (user_id, name)` constraint, which creates an
  index that serves "this user's tag named X" and enforces the duplicate rule at
  the same time.
- `note_tags` has a `PRIMARY KEY (note_id, tag_id)`, which likewise indexes
  lookups by `note_id`. A lookup by `tag_id` alone — "which notes have this tag",
  query 2 — cannot use that index, because it leads with `note_id`. If that
  query became hot, a second index on `(tag_id)` would be the next one to add.

---

## SQL or NoSQL?

**SQL**, with SQLite or PostgreSQL, because the data is relational and the rules
matter more than the flexibility. Notes belong to users, tags belong to users,
and notes and tags are many-to-many — that is a shape relational tables describe
directly, and the `FOREIGN KEY` and `UNIQUE` constraints let the database
enforce the rules itself. Without them, "a tag cannot be added to the same note
twice" and "a note cannot belong to a user who does not exist" would be things
the application code has to remember on every single write, which is exactly
where such rules get forgotten.

The queries that matter here are joins across several tables at once — "every
note tagged travel, with its author's name" — and SQL answers those in one
statement. In a document store that same question is an application-side fan-out:
read the tag, read the `note_tags` rows, read each note, read each user, and join
it all together in memory. That is more round trips, more code, and no
constraints backing it up.

One realistic objection is that tags *could* be a JSON array on the note, since
they are only ever read with their note. SQLite and MongoDB both allow that, and
it would remove the join table. It is rejected here because the array cannot
enforce the duplicate rule and cannot answer "all notes tagged travel" without
parsing every row — and both of those are things QuickNotes genuinely needs.

NoSQL would start to pay off if the workload changed shape: if tags were written
far more often than they were read, or if notes grew attachments and rich
per-user formatting that vary in shape. Neither is true here. The traffic is
20:1 read-to-write (see [`architecture.md`](architecture.md)), the data is
uniformly shaped, and every hot query is a join. SQL is the simpler and safer
choice for this system.
