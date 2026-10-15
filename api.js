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

/* Ids of notes that this page created with POST.

   JSONPlaceholder is a fake API: it answers a create with
   201 and an id, but it never really stores anything, and it
   answers DELETE on any id with 200 whether or not the note
   was ever there. So a note added by createNote exists only
   in this browser tab. Keeping its id lets the delete say so
   honestly instead of implying the server really removed it. */
const localOnlyIds = new Set();


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

    /* Each note carries its own delete button, so one bad
       request only ever touches one note */
    const actions = document.createElement("div");
    actions.className = "note-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "Delete";
    /* The id is kept on the button purely so the test harness
       and a reader can see which note a button belongs to */
    deleteBtn.dataset.noteId = String(note.id);
    deleteBtn.addEventListener("click", function () {
      deleteNote(note.id, deleteBtn);
    });

    actions.appendChild(deleteBtn);
    item.appendChild(actions);

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

    /* Remember that this one only exists in this tab, so the
       delete button can be honest about it later */
    localOnlyIds.add(created.id);

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


/* ---- DELETE: remove a note ------------------------ */

/* About JSONPlaceholder and DELETE: the request really is
   sent, because that is the call we are demonstrating. But
   the fake API replies 200 to a delete of any id, including
   ids that never existed, so a 200 here is weak evidence -
   it proves the endpoint answered, not that anything was
   deleted.

   So the note is removed from the list only after a
   successful response, and the message says plainly which
   kind of note it was. Notes this page created are flagged
   in localOnlyIds, because those were never on the server
   to begin with. Against the real QuickNotes API, where
   DELETE /notes/{id} is specified to answer 204, the same
   code path removes a genuinely stored note. */
async function deleteNote(noteId, button) {
  const wasLocalOnly = localOnlyIds.has(noteId);

  /* Hold this one button, and the other two, so the list
     cannot be redrawn while the request is in flight */
  button.disabled = true;
  submitBtn.disabled = true;
  loadBtn.disabled = true;
  setStatus("Deleting note...", "is-loading");

  try {
    const result = await request("/" + noteId, { method: "DELETE" });

    /* Only now is the note taken off the list */
    notes = notes.filter(function (note) {
      return note.id !== noteId;
    });
    localOnlyIds.delete(noteId);
    renderNotes(notes);

    if (wasLocalOnly) {
      setStatus(
        "Note removed from this page (id " + noteId + "). JSONPlaceholder does not store created notes, so there was nothing on the server to delete.",
        "is-success"
      );
    } else {
      setStatus(
        "Note deleted (status " + result.status + ", id " + noteId + ").",
        "is-success"
      );
    }
  } catch (error) {
    /* The note stays in the list, because it was not deleted.
       Saying "deleted" here would be a lie the user could
       only discover by reloading the page. */
    setStatus("Could not delete the note: " + error.message, "is-error");
  } finally {
    submitBtn.disabled = false;
    loadBtn.disabled = false;
    /* The button is gone now in the success case, so this only
       matters when the delete failed and the note stayed */
    if (button.isConnected) {
      button.disabled = false;
    }
  }
}
