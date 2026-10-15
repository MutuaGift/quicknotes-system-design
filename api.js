/* ============================================
   QuickNotes - API client

   Talks to the JSONPlaceholder test API.
   Every call goes through request(), so the error
   checking is written once and reused.
   ============================================ */

const API_URL = "https://jsonplaceholder.typicode.com/posts";
const NOTES_LIMIT = 10;

/* The title limit, kept in one place so the form hint and
   the check can never drift apart. */
const TITLE_MAX_LENGTH = 100;

/* QuickNotes is single-user in this demo, so every note is
   posted as user 1. With real auth this would come from
   the session instead of being hard-coded. */
const CURRENT_USER_ID = 1;

/* The elements we need from the page */
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const notesList = document.getElementById("notes-list");
const noteForm = document.getElementById("note-form");
const titleInput = document.getElementById("title-input");
const bodyInput = document.getElementById("body-input");
const submitBtn = document.getElementById("submit-btn");
const titleError = document.getElementById("title-error");

/* The notes stay in memory once loaded, so creating and
   deleting can redraw the list without asking again. */
let notes = [];


/* ---- status line ---------------------------------- */

/* One place to change the status text and its colour,
   so the four states can never disagree with each other. */
function setStatus(message, state) {
  statusEl.textContent = message;
  statusEl.className = state ? "status " + state : "status";
}


/* ---- drawing the list ----------------------------- */

/* Draws the list. Anything coming back from the network is
   written with textContent, never innerHTML, so a note
   containing <script> would show up as text instead of
   being run by the browser. */
function renderNotes(list) {
  notesList.replaceChildren();

  /* Empty state - say so plainly rather than leaving a blank area */
  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No notes yet. Press \"Load notes\" to fetch some.";
    notesList.appendChild(empty);
    return;
  }

  list.forEach(function (note) {
    const item = document.createElement("li");
    item.className = "note";

    const title = document.createElement("h3");
    title.textContent = note.title;
    item.appendChild(title);

    const body = document.createElement("p");
    /* A note with no body is legal, so mark it rather than
       printing "null" or an empty gap */
    if (note.body) {
      body.textContent = note.body;
    } else {
      body.className = "is-empty";
      body.textContent = "No body.";
    }
    item.appendChild(body);

    notesList.appendChild(item);
  });
}


/* ---- the one function that talks to the network --- */

/* Reused by every GET, POST and DELETE in this file.
   fetch only rejects when the network itself fails, so an
   HTTP error like 404 or 500 arrives as a normal response
   and has to be checked here by hand. */
async function request(path = "", options = {}) {
  const response = await fetch(API_URL + path, options);

  if (!response.ok) {
    throw new Error("the server replied with " + response.status);
  }

  /* 204 means "done, nothing to send back", so there is no
     body left to parse */
  const data = response.status === 204 ? null : await response.json();

  /* The status is handed back too, because the caller needs
     it to report what the server actually did - a 201 on a
     create is worth showing to the user. */
  return { status: response.status, data: data };
}


/* ---- GET: load the notes -------------------------- */

async function loadNotes() {
  /* Disabled for the whole request so a second click
     cannot start a second one */
  loadBtn.disabled = true;
  setStatus("Loading notes...", "is-loading");
  notesList.replaceChildren();

  try {
    const result = await request("?_limit=" + NOTES_LIMIT);
    notes = result.data;
    renderNotes(notes);
    setStatus("Loaded " + notes.length + " notes from the server.", "is-success");
  } catch (error) {
    /* Clear anything half-loaded so the page is never
       left showing notes from an earlier request */
    notes = [];
    renderNotes(notes);
    setStatus("Could not load notes: " + error.message, "is-error");
  } finally {
    /* Runs whether the request worked or failed */
    loadBtn.disabled = false;
  }
}

loadBtn.addEventListener("click", loadNotes);


/* ---- POST: create a note -------------------------- */

/* The title is the only thing the server insists on.
   Returns { ok, message } so the caller has one thing
   to check, and { ok, value } with the trimmed title. */
function validateTitle(raw) {
  const title = raw.trim();

  /* Whitespace only counts as empty: a title of "   "
     is not something anybody meant to write. */
  if (title === "") {
    return { ok: false, message: "Please give your note a title." };
  }

  if (title.length > TITLE_MAX_LENGTH) {
    return {
      ok: false,
      message: "The title must be " + TITLE_MAX_LENGTH + " characters or fewer."
    };
  }

  return { ok: true, value: title };
}

async function createNote(event) {
  /* Stop the browser doing a normal form submit, which
     would reload the page and throw the notes away */
  event.preventDefault();

  const check = validateTitle(titleInput.value);

  /* Bad input never reaches the network */
  if (!check.ok) {
    titleError.textContent = check.message;
    titleInput.classList.add("has-error");
    setStatus(check.message, "is-error");
    titleInput.focus();
    return;
  }

  titleError.textContent = "";
  titleInput.classList.remove("has-error");

  /* Both buttons are held while the request is in flight,
     so the list cannot be redrawn underneath it */
  submitBtn.disabled = true;
  loadBtn.disabled = true;
  setStatus("Saving note...", "is-loading");

  try {
    const result = await request("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: check.value,
        /* The body is optional, so it may legitimately be
           an empty string - which is not the same as null */
        body: bodyInput.value.trim(),
        userId: CURRENT_USER_ID
      })
    });

    const created = result.data;

    /* Newest first, the way a feed reads */
    notes.unshift(created);
    renderNotes(notes);

    /* Only clear the form once the server has accepted it,
       so a failed save does not throw away the user's typing */
    noteForm.reset();
    titleInput.focus();

    setStatus(
      "Note created (status " + result.status + ", id " + created.id + ").",
      "is-success"
    );
  } catch (error) {
    /* Whatever was typed is left in place so it can be retried */
    setStatus("Could not save the note: " + error.message, "is-error");
  } finally {
    submitBtn.disabled = false;
    loadBtn.disabled = false;
  }
}

noteForm.addEventListener("submit", createNote);

/* Clear the inline error as soon as the user starts fixing it,
   rather than making them submit again to find out */
titleInput.addEventListener("input", function () {
  if (titleError.textContent !== "") {
    titleError.textContent = "";
    titleInput.classList.remove("has-error");
  }
});
