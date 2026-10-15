/* ============================================
   QuickNotes - API client

   Talks to the JSONPlaceholder test API.
   Every call goes through request(), so the error
   checking is written once and reused.
   ============================================ */

const API_URL = "https://jsonplaceholder.typicode.com/posts";
const NOTES_LIMIT = 10;

/* The elements we need from the page */
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const notesList = document.getElementById("notes-list");

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

  const data = await response.json();

  /* The status is handed back too, because the caller needs
     it to report what the server actually did. */
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
