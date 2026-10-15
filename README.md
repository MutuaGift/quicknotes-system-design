# QuickNotes

A note-taking app and the design documents for the service behind it.

QuickNotes was a browser-only page with notes stored in memory. This project is
the step up to a real online service for **1 million people**: a working API
client that talks to a REST API over the network, plus the API, data model and
architecture documents the backend team will build from.

There are two halves to this, and they are deliberately different kinds of work:

- **Prove the front end can talk to an API.** A real page that loads, creates and
  deletes notes over HTTP, against the [JSONPlaceholder](https://jsonplaceholder.typicode.com)
  practice API, with loading, success, error and empty states handled properly.
- **Design the service behind it.** The API QuickNotes should actually expose,
  the tables it should store things in, and the architecture that carries 1
  million users.

The front end talks to a throwaway practice API so it can be demonstrated today
with no backend. The documents describe the real service.

---

## How to run it

The front end is plain HTML, CSS and JavaScript. There is nothing to install and
no build step.

**Option 1 — just open it**

Open `index.html` in a browser. Note that some browsers block network requests
from `file://`, so if "Load notes" refuses to work, use option 2.

**Option 2 — serve it** (recommended, and what the tests below assume)

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

### What to try

| Do this | What happens |
| --- | --- |
| Click **Load notes** | Fetches 10 notes. The button disables, the status shows "Loading notes...", then "Loaded 10 notes from the server." |
| Submit the form with an empty title | Blocked before any request. Nothing is sent. |
| Submit a title over 100 characters | Same — caught in the browser. |
| Submit a valid note | `POST`, then "Note created (status 201, id 101)." and it appears at the top of the list |
| Click **Delete** on a note | `DELETE`, then it disappears |
| Turn off your network and click **Load notes** | A friendly error, and the button becomes usable again |

### The files

| File | What it is |
| --- | --- |
| [`index.html`](index.html) | The page: form, load button, status line, notes list |
| [`api.js`](api.js) | All the network code — `request()`, GET, POST, DELETE, validation, rendering |
| [`style.css`](style.css) | Styling, including the distinct success and error status styles |

---

## The design documents

| Document | What it covers |
| --- | --- |
| [`docs/api-design.md`](docs/api-design.md) | 12 REST endpoints with methods, paths and status codes, request/response examples for creating and listing notes, and the error codes the API can return |
| [`docs/data-model.md`](docs/data-model.md) | The `users`, `notes`, `tags` and `note_tags` tables, the one-to-many and many-to-many relationships, the `CREATE TABLE` statements, four worked queries, an index, and the SQL vs NoSQL decision |
| [`docs/architecture.md`](docs/architecture.md) | Functional and non-functional requirements, load estimates for 1 million users, an architecture diagram, what each component solves, the `GET /notes` and `POST /notes` flows, trade-offs, and how single points of failure are avoided |

---

## How the front end is built

Every network call goes through **one** function:

```js
async function request(path = "", options = {}) {
  const response = await fetch(API_URL + path, options);

  if (!response.ok) {
    throw new Error("the server replied with " + response.status);
  }

  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data: data };
}
```

`GET`, `POST` and `DELETE` all call it, so the error checking is written once and
cannot drift between them. The important subtlety is that **`fetch` only rejects
when the network itself fails** — an HTTP error such as 404 or 500 arrives as an
ordinary response, which is why `response.ok` has to be checked by hand. Without
that check a failed request looks like a successful one.

Some other decisions worth knowing about:

- **`textContent` only, never `innerHTML`.** Notes come from a network response,
  so their text is inserted as text. A note containing `<script>` would be
  displayed, not executed.
- **Buttons are disabled for the whole request.** Loading and deleting can be
  double-clicked otherwise, and two overlapping requests leave the list showing
  results from whichever finished last.
- **`try` / `catch` / `finally` around every request.** The `finally` is what
  re-enables the buttons whether the request worked or failed.
- **A failed delete keeps the note in the list**, because it was not deleted.
  Saying otherwise would be a lie the user only discovers on reload.
- **JSONPlaceholder does not really store created notes.** It answers a create
  with `201` and an id, and then answers `DELETE` on *any* id with `200`,
  including ids that never existed. So the app records which notes it created
  itself, and says so plainly rather than implying the server really deleted
  something. `api.js` explains this in a comment where it happens.

---

## What I learned

**One reusable `request()` function beats three that each fetch on their own.**
GET, POST and DELETE looked like three separate problems until I noticed they
shared everything except the URL and the method. Writing the error handling once
meant the `response.ok` check, the 204 case and the error message could not
disagree with each other later — and when I changed how errors were reported, it
took one edit instead of three.

**`fetch` does not reject on HTTP errors, which is the single most common
mistake with it.** My first instinct was that `await fetch()` inside a `try`
would catch a 404. It does not: the promise resolves happily with
`response.ok === false`, and the body is whatever the server sent. Every error
message in this app depends on checking `response.ok` explicitly, and the
difference was only obvious because I tested the failure path rather than
assuming it worked.

**Testing the unhappy path found bugs that testing the happy path never would.**
Two of the three defects I hit were in states I would never have seen by clicking
around: a note with no body printing `null`, an error message appearing while the
button stayed disabled, and a stale list left on screen after a failed load. I
ended up driving the page in a headless browser and asserting on each state —
loading, success, error, empty, validation failure — because "it looked fine" is
not evidence. I also learned to check my *test* before blaming the code: twice
the fault was in my harness, not the app.

**`textContent` is not a detail, it is the whole security model of a page.**
The notes in this app come from a network response, so anything in them is
untrusted. Using `innerHTML` for convenience would mean one note titled
`<img src=x onerror=...>` runs JavaScript for every user who loads the feed.
Building the list with `createElement` and `textContent` costs a few more lines
and removes the entire category of bug.

**The numbers in a design document change the design.** Working the load out for
1 million users gave 116 reads and 6 writes per second at peak — a workload one
server handles. That killed the version of the architecture I had started
writing, which had sharding and multi-region because "1 million users" sounds
big. The numbers said the honest design is small and simple, and the only
genuinely hard problem is the single writer, not throughput.

**A database is a better place for a rule than application code.** Writing
"this tag cannot be added to the same note twice" once as a `PRIMARY KEY
(note_id, tag_id)` in the schema means every future feature inherits the rule for
free. Checking it in JavaScript means it has to be remembered in every handler
that inserts a row — and it will eventually be forgotten in one of them. The
same reasoning decided the privacy requirement: ownership comes from the token,
and the database enforces the references.
