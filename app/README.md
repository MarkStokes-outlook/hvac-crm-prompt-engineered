# FrostLine Operations — CRM & service management

A working CRM and operations system for Frostline Mechanical Services, a commercial HVAC contractor. It covers customers, sites, equipment and their history, reactive, planned, quoted and installation jobs, scheduling engineers, a mobile app for engineers, contracts and response targets, quotes, depot and van stock, and purchase orders. There's also an optional AI assistant that works through the same business rules as the rest of the app.

## Run it

Requirements: Node.js 22+.

```bash
cd app
npm install
npm start            # builds the UI and serves everything at http://localhost:3001
```

The first start creates `data/frostline.db` and fills it with demo data. The demo data is generated relative to today, so there is always work booked today, something overdue, and planned maintenance coming up.

| Command | What it does |
|---|---|
| `npm start` | Build the front end and run the app on port 3001 |
| `npm run dev` | Development mode: API on 3001 with reload, UI with hot reload on http://localhost:5173 |
| `npm run reset` | Delete everything and recreate the demo data (uploaded photos too) |
| `npm test` | Unit and API tests (Vitest) — state transitions, permissions, and the AI proposal/confirm flow |
| `npm run test:e2e` | Browser tests (Playwright) against a throwaway database. The first time, run `npx playwright install chromium` |
| `npm run typecheck` | TypeScript check across server, UI and tests |

### Demo users

Every demo user's password is `frostline`. The sign-in page also has one-click buttons for each user.

| User | Role | Sees |
|---|---|---|
| Martin Hale, Susan Mercer | Manager | Everything, including settings, account holds and the audit log |
| Priya Nair, Tom Whitaker | Coordinator | Jobs, scheduling, stock, purchase orders. Can draft quotes, but not issue or accept them |
| Rachel Dunn | Sales / estimator | Customers, contracts, quotes. Jobs and schedule are read-only |
| Dave Kershaw, Lewis Tran, Sam O'Connor, Aisha Rahman, Gareth Pike, Kyle Brennan, Nathan Holt | Engineer | The mobile app: their own visits, the sites they're working at, their van stock |

Mick Farrell is a subcontract engineer with no login, so he can be scheduled but not signed in as. Engineer emails follow the pattern `first.last@frostline.example`.

### Turning on the AI assistant

The assistant is optional. Set `ANTHROPIC_API_KEY` before starting the app, or set `FROSTLINE_AI=on` if you use an `ant auth login` profile:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Optional settings: `FROSTLINE_AI_MODEL` (default `claude-opus-5`) and `FROSTLINE_AI_EFFORT` (default `medium`). Set `FROSTLINE_AI=off` to disable the assistant explicitly. Without the assistant, every screen and workflow still works. The AI panels simply say it isn't configured.

## What's in it

- **Customers, sites, contacts, equipment.** Search works across customer names, sites, addresses, postcodes and contacts. Each asset has a service history (every visit that touched it, its condition, readings, notes, parts and photos), warranty status, and a refrigerant CO₂e calculation with an F-gas leak-check flag.
- **Jobs.** Reactive, planned maintenance, quoted works, installation, survey and warranty. When a job is logged, the site's active contract is found automatically and the response target comes from that contract's terms. The form shows what will apply before you save. Job states are: to schedule → scheduled → in progress → on hold (with a reason) → completed → closed, plus cancelled. The system moves jobs between states based on what happens to their visits, so nobody needs to update a status by hand.
- **Scheduling.** A day board with a lane per engineer, showing absences, out-of-hours shading, the current time and a queue of unscheduled jobs. You can drag a job onto a lane, or open it to see ranked engineer suggestions. The ranking explains itself: free time, skills recorded for the equipment, previous visits to the site, base region and workload. Double bookings, absences, out-of-hours slots, skill gaps and slots after the response target need an explicit "continue anyway", which is recorded. There's also a week view.
- **Engineer app (phone first).** Today's work, one-tap "on my way" and "arrived", directions and call buttons, access notes, per-asset condition checks with readings, parts used from the van (stock is deducted), photos from the camera, a customer sign-off with signature, recommendations, and a finish-visit outcome. The outcome drives what happens next:
  - fixed → job complete
  - come back → back in the scheduling queue with the reason
  - parts needed → on hold for parts, with parts requirements listed
  - needs a quote → on hold for a quote, with a recommendation raised for the office
  - no access → rebook
- **Quotes.** Draft → sent → accepted or rejected, plus revisions (the old version is marked superseded) and withdrawal. An expired quote can still be accepted, with a warning. Accepting a quote creates the job, or resumes the job that was waiting for it, and quoted parts become parts requirements. Rejecting a quote that a job was waiting on flags that job for review so it doesn't sit on hold unnoticed. Engineer recommendations feed a queue that the office can quote from.
- **Contracts.** Terms include response targets per priority, out-of-hours cover, whether labour and parts are included, and planned maintenance frequency. Planned maintenance jobs can be generated for a date range, and running it twice won't create duplicates. Each contract shows how many response targets were met or missed.
- **Stock.** Depot store and vans, with every change recorded as a movement: transfers, stock counts, parts used, receipts. Anything below minimum is listed for reordering. Purchase orders go draft → ordered → part received → received and can be linked to jobs. When the last part a job is waiting for is received, the job comes off hold and returns to the scheduling queue.
- **Dashboard.** Response targets at risk or overdue, unscheduled work, jobs on hold, today's visits, absences that clash with existing bookings, quotes to chase, contracts ending soon and planned maintenance coming due.
- **Audit.** Every change is recorded with who made it and whether it came from a person directly or from the assistant (confirmed by a person). Jobs, quotes, customers and purchase orders each show their own history.

### How the AI works

- **Assistant panel** (office roles). You can ask it things like "Who can attend the Rossendale House emergency today?", "Log this call…", "Book Lewis tomorrow morning" or "Draft a quote for that recommendation". It calls the same functions the screens use, as the signed-in user, so permissions and business rules are identical.
  - Anything that changes data is only a **proposal**. It's checked first with a dry run inside a transaction that is rolled back, so it goes through every real business rule. You then see a card with Confirm and Discard buttons.
  - Only Confirm executes it, and the change is recorded as "via assistant". Scheduling conflicts come back to the assistant so it can tell you about them before proposing.
- **Fill in from email** on the Log-a-job page: paste a customer email and the job form is filled in for you to check.
- **"Brief me"** on customer, site and equipment pages: a short summary of a scattered history.

It uses Claude (`claude-opus-5`) with adaptive thinking and server-side refusal fallback.

## Code layout

```
server/            Express + SQLite (better-sqlite3)
  schema.sql       data model
  services/        all business rules (jobs, visits/scheduling, quotes, contracts, stock, customers, settings)
  ai/              assistant tools + agent loop (tools call services; writes become proposals)
  app.ts           HTTP routes (thin)
  seed.ts          demo data, relative to today
web/src/           React UI (office pages + engineer/ mobile app)
tests/             Vitest: workflow, AI, API
e2e/               Playwright: full workflows in a real browser
```

## Assumptions and open questions

The brief and the FrostLine website don't state many business rules. Rather than build guesses in as fixed FrostLine policy, the app makes them configurable (Settings → Business settings, where each one shows where its default came from), or makes them visible, or leaves them unset:

| Area | What the app does | Why / what to confirm |
|---|---|---|
| Response targets | Taken **only** from contract terms, per priority. Non-contract work has **no** target unless a manager sets one. Measured in clock hours from when the job is logged to the engineer's arrival. | The website promises nothing to non-contract customers. Confirm whether contracts measure in working hours, and whether the target is to attend or to fix. |
| Priorities | Emergency / urgent / routine / planned, chosen by the coordinator. | Nothing defines what counts as each. The AI only *suggests* a priority when reading emails. |
| Working hours | 08:00–17:00, Monday to Friday (setting). Used for scheduling warnings only. | The website mentions the service desk's hours, not engineers' hours. Out-of-hours rotas aren't modelled. |
| Account hold | Warns but still allows new jobs by default. A manager can switch it to block. | Blocking emergency work could be unsafe, and the policy is unknown. |
| Quote pricing | VAT 20%, 30-day validity, and a **£65/h labour rate that is a demo value only**. No internal approval step. | Replace the rate. Confirm whether quotes above some value need approval. |
| Roles and permissions | The role matrix in `server/permissions.ts`. For example, only sales and managers issue quotes and record acceptance, and only managers set account holds. | This was an implementation choice. Adjust it to FrostLine's real responsibilities. |
| Van stock | Engineers can record parts even if the van record shows none left. Stock goes negative and is flagged for a count. | This avoids blocking work on site because the records are wrong. |
| Planned maintenance | Visits are spaced evenly across each contract year from its start date. | Real plans may follow seasons (e.g. school holidays) or be asset-specific. |
| Skills | Skill tags on equipment categories are a scheduling *hint*, never a block. | Competence and certification rules (F-gas category, Gas Safe, DBS for schools) aren't enforced. |

### Limitations

- No offline mode in the engineer app (it needs signal). No push notifications.
- Quotes and purchase orders are marked "sent"/"ordered" in the app. Emailing or printing them to the customer or supplier happens outside it (the quote page prints cleanly).
- No invoicing or accounts integration. "Closed" means the job has been reviewed and is ready to pass to accounts.
- No user administration screen. Users come from the seed data or the database.
- Maps and travel times aren't used. Suggestions only use each engineer's base region.
- Times are UK local time. Around clock changes, response due times can be an hour out.
- The AI assistant's tool loop and UI are tested with a scripted stand-in model. It hasn't been run against the live API in this environment because there are no credentials.
