# QuickNotes Architecture

How QuickNotes should be built to serve **1 million registered users**. This
covers what the system must do, how much load it must carry, the components
that carry it, what happens during a request, and what it costs.

---

## 1. Requirements

### Functional

- **F1** — A user can register and sign in, and receive a token.
- **F2** — A signed-in user can create a note with a title and an optional body.
- **F3** — A user can list, read, edit and delete their own notes.
- **F4** — A user can tag a note, and a tag can be applied to many notes.
- **F5** — A user can list their notes filtered by tag, newest first.
- **F6** — A user can mark a note public and browse another user's public notes.
- **F7** — A user sees clear error messages for validation, permission and server
  faults, with a `request_id` they can quote.

### Non-functional

- **N1** — A page of notes should appear in **under 300 ms** at the 95th
  percentile, from any region.
- **N2** — The service must survive the loss of any **one** component without
  losing data or going down for all users.
- **N3** — **99.9% availability** — about 43 minutes of downtime a year.
- **N4** — Writes must be **durable**: a note the server acknowledged must not be
  lost.
- **N5** — Notes are **private by default**. A note must never be readable by
  someone who is not its owner, except where it was explicitly made public.
- **N6** — The system must scale **horizontally** — more machines, not bigger
  ones — and be deployable without downtime.

**N5 is the one that shapes the design most.** Privacy is a correctness
requirement, not a feature, so it is enforced in the database and the API layer
rather than left to the client.

---

## 2. Load estimate

### Assumptions

- **1,000,000 registered users.**
- **10% are active on any day** → **100,000 daily active users**.
- Each active user **reads 20 note pages a day**.
- Each active user **writes 1 note a day**.
- Each note averages **2 KB** of title plus body.
- A day is **86,400 seconds**, a year is **365 days**.
- Peak is taken as **5× the average**.

### The numbers

```
Daily active users = 1,000,000 x 10%            = 100,000

Reads  = 100,000 x 20 pages/day = 2,000,000/day
       = 2,000,000 / 86,400     = 23.15 reads/sec average
       = 23.15 x 5              = 116 reads/sec at peak

Writes = 100,000 x 1 note/day  = 100,000/day
       = 100,000 / 86,400      = 1.16 writes/sec average
       = 1.16 x 5              = 5.8 writes/sec at peak

Storage = 100,000 x 2 KB/day   = 195 MB/day
        = 195 MB x 365         = 0.07 TB per year  (about 73 GB)
        x 3 copies (primary + replica + backup)
                               = 0.21 TB per year
```

| Quantity | Average | Peak (5×) |
| --- | --- | --- |
| Daily active users | 100,000 | — |
| Reads per second | 23.15 | **116** |
| Writes per second | 1.16 | **5.8** |
| Storage per year | 73 GB | 0.21 TB with 3 copies |

### What these numbers mean

**The load is genuinely small, and that is the most important finding in this
document.** 116 reads and 6 writes per second is a workload one modest server
handles comfortably. QuickNotes at 1 million users does **not** need a
distributed system to survive its own traffic.

The temptation is to read "1 million users" and reach for microservices,
sharding and multi-region. That would be building for a problem the numbers do
not show. The sensible design is a small number of stateless app servers in front
of **one** primary database, sized so there is room to grow — and to keep the
*seams* that let it become more later, without paying for the complexity now.

The real constraint is **not throughput, it is the 20:1 read-to-write ratio and
the privacy requirement.** That is why the cache and the read replica earn their
place: not because 116 reads/sec would overwhelm a database, but because
serving them from cache keeps the primary free for the writes that genuinely
must not fail, and keeps the app servers cheap.

Storage is the number that grows forever. 73 GB a year is trivial today and
becomes 730 GB in ten years, so the storage plan — not the server plan — is what
needs revisiting first.

---

## 3. Architecture

```
   QUICKNOTES - 1 million users
   =================================================================

   +------------------+      +----------------+
   |  DNS             |      |   CDN          |  static assets, cached
   |  name -> any     |----->|  edge, nearest |  JS/CSS/images
   |  healthy server  |      |  to the user   |
   +------------------+      +-------+--------+
                                   |
                                   v
                           +-------+---------+
                           | Load balancer   |  TLS, health checks,
                           | (L4/L7)         |  spreads across servers
                           +-------+---------+
                                   |
             +---------------------+---------------------+
             |                     |                     |
     +-------v--------+    +-------v--------+    +-------v--------+
     |  App server 1  |    |  App server 2  |    |  App server N  |
     |  stateless API |    |  stateless API |    |  stateless API |
     +-------+--------+    +-------+--------+    +-------+--------+
             |                     |                     |
             |            +--------+---------+           |
             |            |                  |           |
     +-------v--------+   |                  |   +-------v--------+
     |     CACHE      |   |                  |   |     QUEUE      |
     | Redis:         |   |                  |   | email, feed    |
     | user's notes   |   |                  |   | fan-out        |
     +----------------+   |                  |   +-------+--------+
                          |                  |           | async
                          |           +------v---------+v---------+
                          |           |      WORKER               |
                          |           |  email sender, notifier  |
                          |           +----------------------------+
                          |
              +-----------+-----------+
              |                       |
      +-------v--------+     +--------v-------+
      |  DB PRIMARY    |     |  DB REPLICA    |
      |  the ONLY      |---->|  read-only     |
      |  writer        |     |  copies, serves|
      | users, notes,  |     |  all reads     |
      | tags           |     +----------------+
      +-------+--------+
              |
              | WAL, streamed
              v
      +-------+--------+
      | READ REPLICA   |
      +----------------+


   +------------------+---------------------------+--------------------+
   |     COMPONENT     |          ROLE             |  SINGLE POINT?    |
   +------------------+---------------------------+--------------------+
   | DNS              | maps name to healthy IPs    | no (many records) |
   | CDN              | serves static from the edge | no               |
   | Load balancer    | spreads load, health checks| mitigated         |
   | App servers      | stateless business logic    | no (N of them)    |
   | Cache            | rendered notes, near user  | no (can be lost)  |
   | DB primary       | the only writer            | YES - replicated  |
   | DB replica       | serves reads               | no (rebuildable)  |
   | Queue            | decouples slow work        | no               |
   | Worker           | email, fan-out             | no               |
   +------------------+---------------------------+--------------------+
```

---

## 4. What each component solves

- **DNS** — Turns `api.quicknotes.example.com` into the addresses of machines that are actually up, so a server going away stops being handed out new requests.
- **CDN** — Serves the HTML, CSS, JavaScript and images from a server near the user, so most page loads never touch our infrastructure at all.
- **Load balancer** — Spreads incoming requests across the app servers and health-checks them, so one failing server is taken out of rotation instead of failing requests.
- **App servers** — Stateless processes that run the actual business logic; because they hold no state, any of them can answer any request and the fleet scales by adding more.
- **Cache (Redis)** — Keeps each user's recently-read notes in memory so the commonest read does not hit the database at all, which is what protects the writer from the 20:1 read traffic.
- **DB primary** — The single source of truth for users, notes and tags, and the only component that accepts writes, so there is never any doubt about who wrote what.
- **DB replica** — A read-only copy that serves every read, so read capacity grows by adding replicas instead of by overloading the writer.
- **Queue** — Holds background work so an app server returns a response immediately rather than waiting for an email to send, and so a burst of work is buffered rather than dropped.
- **Worker** — Takes jobs off the queue and does the slow, failure-prone work away from the request path, where a retry or a failure cannot affect a user waiting for a response.

---

## 5. Request flows

### `GET /v1/notes` — reading a list of notes

1. **Client** asks DNS for `api.quicknotes.example.com` and gets back a load balancer address.
2. **Client** sends the request, with its bearer token, to the **CDN**.
3. **CDN** has no API responses to give (it serves static assets), so it forwards to the **load balancer**.
4. **Load balancer** health-checks its app servers and forwards the request to a healthy one, say **App server 2**.
5. **App server 2** checks the **cache** for this user's note list.
6. **Cache hit?** The cached list is returned immediately and the request stops here. This is the common case, and it is why the database is quiet.
7. **Cache miss?** The app server queries the **DB replica** — never the primary for a read, which keeps the writer free.
8. **DB replica** returns the rows, joining `notes` and `users` so the author's display name comes back with them.
9. **App server 2** writes the list into the **cache** with a short time-to-live, so the next request skips steps 7 and 8.
10. **App server 2** returns `200 OK` with the notes.
11. **CDN** and the client render them.

No queue and no worker are involved: reading is synchronous and fast, and putting
it on a queue would only add delay.

### `POST /v1/notes` — creating a note

1. **Client** sends `POST /v1/notes` with `{title, body}` and its bearer token, through the **CDN** and **load balancer**, to an **app server**.
2. **App server** verifies the token and loads the user, so `user_id` comes from the token and never from the request body — otherwise anyone could write notes as another user.
3. **App server** validates the title (required, at most 100 characters). If it fails, it returns `400` **without touching the database**.
4. **App server** invalidates this user's entry in the **cache**, so the new note cannot be served from a stale cache after it is created.
5. **App server** writes the note to the **DB primary** in a transaction. Only the primary accepts writes.
6. **DB primary** commits and writes the change to its **write-ahead log**, which is streamed to the **read replica**. The app server does not wait for the replica to catch up.
7. **DB primary** returns the new row with its generated `note_id`.
8. **App server** puts a job on the **queue** — "welcome email", "index this note for search".
9. **App server** returns `201 Created` with the new note and a `Location` header. The user sees their note immediately.
10. **Worker** picks the job off the **queue** and does the slow work.
11. **Read replica** receives the change from the log and serves it on the next read.

The ordering matters. Step 3 rejects bad input before any write, step 4 clears the
cache before the row changes, and step 8 hands the slow work away before
responding. A user never waits on an email.

---

## 6. Trade-offs

### 1. Cache for speed, at the cost of staleness

Serving notes from Redis means a note written a moment ago may not appear in a
cached list for up to the time-to-live, and a deleted note may linger similarly.

The alternative — querying the database on every read — turns 116 reads/sec at
peak into database traffic for data that rarely changes between reads. At this
scale the database could easily take it, so the honest conclusion is that the
cache is **not yet required**; it is added now because it is cheap and because it
keeps headroom. **Short time-to-live values (30–60 seconds) and an explicit
invalidation on write** keep the window small.

### 2. A single writer: simple and consistent, but one hard target

Sending every write to one primary is the simplest design that can possibly be
correct: there is no conflict resolution, no two writers disagreeing, and no
distributed transaction. It is also a **single point of failure**, and it is the
one real risk in this architecture.

The trade is accepted deliberately, because at 5.8 writes/sec at peak the
primary is nowhere near its limit. It is mitigated by synchronous replication to
at least one stand-by, so losing the primary loses at most the last few
milliseconds of acknowledged writes, and by automatic failover to that stand-by.
**If writes ever grew a hundredfold, this is the first thing that would have to
change** — sharding by `user_id` would spread the writes while keeping each
user's notes on one shard, and that ordering constraint is kept in mind by
giving every note a `user_id`.

### 3. Read replicas: cheap reads, stale reads

Offloading reads to a replica is the cheapest way to add read capacity. The cost
is replication lag: a note created a moment ago may not be on the replica yet,
so a user who creates a note and immediately reloads could be shown a list that
does not include it.

The usual fix is **read-your-writes**: after a write, the client reads from the
primary (or from the cache, which the write just invalidated) for a few seconds.
This is why step 4 of the create flow invalidates the cache rather than waiting
for it to expire.

### 4. Queue for background work, at the cost of eventual delivery

Email and notifications are queued so a user is not made to wait for them. The
trade is that they become **eventually** delivered: a job can sit in the queue
longer than expected, and if the queue is down when a note is created, that job
is not done.

Queues guarantee *at least once* delivery, so a worker may see the same job
twice, which means the work has to be **idempotent** — the same email must not
be sent twice. That is simpler and cheaper than pursuing exactly-once delivery,
and it is the right call at this scale.

### 5. Synchronous replication: durability, paid for in latency

Acknowledging a write only after a stand-by has it means an acknowledged write
survives the loss of a machine, which is what `N4` demands. The cost is that
every write waits for the stand-by, adding a round trip of latency to all writes.

Asynchronous replication would be faster, but a crash could lose writes that had
already been reported as successful. For a note-taking app where the data is the
whole point, durability wins over a few milliseconds.

---

## 7. Avoiding single points of failure

| Component | Risk | How it is handled |
| --- | --- | --- |
| **App server** | Crashes, or is deployed badly | More than one, **stateless**, behind a health-checking load balancer. Any can serve any request, so one can be killed mid-deploy with no effect. |
| **DB primary** | **The real single point of failure** | Synchronous replication to a stand-by, with automatic failover. This is the weakest point in the design and the first thing to strengthen. |
| **DB replica** | Fails or falls behind | Read-only and **rebuildable from the primary**, so it can be replaced with no data loss. If every replica is down, reads fall back to the primary rather than the site going down. |
| **Cache** | Fails or is empty | Treated as **an optimisation, never a source of truth**. A miss falls through to the database, so losing Redis costs speed, not correctness or data. |
| **Queue** | Fails or backs up | Holds only **regenerable** work — emails, notifications. Nothing the user is waiting on sits in the queue, so its failure delays a side effect and nothing else. |
| **Worker** | Crashes mid-job | Jobs are **idempotent** and re-queued on timeout, so a crash causes a retry rather than a lost or doubled action. |
| **Load balancer** | Fails | Two or more, behind DNS with a health-checked record, so users are sent to a surviving one. |
| **DNS** | Cache keeps pointing at a dead server | Short time-to-live, so a change propagates quickly; the load balancer's health checks do the real work. |

**The principle running through all of this:** state lives in exactly one place —
the database primary — and everything else is either stateless or rebuildable.
The cache can be wiped, a replica can be rebuilt, a queue can be drained, and
none of those loses a note.

**What would be done next, in order:**

1. **Automated failover** for the primary, so recovery does not depend on a human noticing.
2. **Multi-region** read replicas, to cut latency for users far from the primary — the requirement `N1` implies this eventually.
3. **Sharding by `user_id`**, if write volume ever grows enough to need it. Because every note already carries a `user_id`, that split is available without a redesign.

---

## 8. Summary

QuickNotes at 1 million users needs **116 reads and 6 writes per second** at
peak. That is a small workload, and the honest design is a small one: stateless
app servers behind a load balancer, one primary database, a replica for reads,
and a cache and queue doing the work that does not need to be immediate.

The parts that are not optional are the ones that protect **data** and
**privacy**: a single writer with synchronous replication and automatic failover,
foreign keys and unique constraints in the database rather than in application
code, and ownership taken from the token rather than the request body.

Storage — 73 GB a year today, 730 GB in ten — is the constraint that will matter
long before throughput does.
