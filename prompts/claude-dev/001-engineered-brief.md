# FrostLine CRM / Operations System

## Objective

Build a working CRM and operations system for FrostLine, a UK commercial HVAC engineering company. FrostLine works across air conditioning, heating, ventilation and refrigeration, including maintenance, repairs and installation work.

The goal is to replace much of the day-to-day reliance on spreadsheets, shared mailboxes and separate systems with one coherent application that people can genuinely use to operate the business.

A copy of FrostLine's current public website is available under `reference/`. Inspect the repository and that material before designing or implementing the application. Treat it as useful evidence about the company and its services, but do not assume that a public website describes every internal business rule.

## Business capabilities we know are needed

The application should provide normal CRM capabilities for customers and contacts. Customers can have multiple sites, and sites can have equipment installed at them. Users need to be able to understand the history of work associated with a customer, site and relevant equipment.

Service work is central to the business. Customers report faults by phone or email, office staff log the work, and jobs are scheduled to engineers. FrostLine also performs planned maintenance, so the job model needs to support more than breakdowns. Engineers need an effective way to see their work and record what happened, including appropriate notes, photos, parts used and similar visit information. Office users need a useful scheduling view showing engineers, their work and availability.

Some customers have service or maintenance contracts and some do not. Contracts can affect things such as response times. FrostLine also quotes for work, ranging from repairs identified during engineering visits through to larger installation or replacement work. Quotes need a sensible lifecycle, including accepted and rejected outcomes, and accepted work should be capable of becoming operational work.

Basic stock and parts management is required. Engineers carry commonly used parts in vans, FrostLine also holds stock at the office, and parts may need to be ordered from suppliers. Keep this proportionate: the application is primarily an operations/CRM system and is not intended to replace FrostLine's accounting package or become a full ERP platform.

## Users and experience

The application will be used by different kinds of people, including office/service-desk staff, managers, engineers and sales/admin users.

Office users will generally work on desktop computers. Engineers will predominantly use phones or tablets, so engineer workflows must be genuinely usable on smaller/mobile screens rather than simply shrinking a desktop interface.

Provide a coherent conventional user interface. AI should complement the application, not replace the entire UI with a chat window.

## AI expectations

AI should be a useful operational capability rather than a chatbot bolted onto the product.

An office user should ideally be able to use natural language for useful operational tasks such as finding customers or information, creating jobs, helping determine who can attend, scheduling work and assisting with quotes. Look for other places where AI can remove repetitive multi-screen work or help users understand relevant operational information.

AI-driven actions must still behave consistently with the application's normal business rules, permissions and data model. Users should be able to understand what consequential actions the system has taken.

The application must remain useful when AI functionality is unavailable or not configured.

## Implementation expectations

This is not a visual prototype. Deliver a proper working application with persistent data and realistic demo data so the main workflows can be exercised immediately.

Choose an appropriate technology stack. It should be straightforward to run locally for now; a production deployment may happen later if the application proves useful.

Optimise for a coherent end-to-end product rather than a collection of disconnected screens. Important workflows should preserve the relationships between customers, sites, equipment, jobs, engineering activity, contracts, quotes and stock where those relationships matter.

Use realistic demo users, customers, sites, equipment and operational activity. Seed data should make it possible to exercise ordinary workflows and meaningful edge conditions without manually constructing the entire business first.

## Approach to uncertainty and assumptions

Distinguish between implementation decisions and FrostLine-specific business policy.

You may make sensible technical, architectural and UX decisions yourself. Where business behaviour is not established by this brief or the supplied reference material, do not silently turn a convenient assumption into an immutable FrostLine rule.

Prefer designs that preserve uncertainty, make material assumptions visible, or allow genuinely variable business configuration where appropriate. Do not invent company-specific policy merely because a value or workflow is needed by the implementation.

At the same time, do not over-engineer the application around hypothetical possibilities. Use ordinary industry understanding where it is reasonable to interpret the brief, while recognising that plausible industry practice is not automatically FrostLine policy.

## Development approach

Before implementation, inspect the available evidence and establish a coherent domain and workflow model for the application. Think through how the major records relate and how important workflows change business state before committing to the UI or database shape.

Build vertically through realistic workflows rather than implementing isolated feature checklists. Validate that actions produce the intended persistent state and that later parts of a workflow see the consequences of earlier actions.

Pay particular attention to boundaries where an apparently successful UI action could leave inconsistent or misleading operational state. Avoid equating the existence of a screen, field or status with correct workflow behaviour.

Implement appropriate permissions for the different user roles and avoid giving every user unrestricted operational capability merely for convenience.

Keep the solution proportionate. Do not spend the majority of the effort producing design documents before building. Short working notes or a concise plan are fine where useful, but the deliverable is the working application.

## Verification and completion

Exercise the important workflows using the running application, not only unit-level code inspection. Add automated tests where they provide useful confidence in important behaviour and state transitions.

Check desktop and engineer/mobile experiences. Verify persistence and seeded/resettable demo data. Ensure the project builds and can be started from clear repository instructions.

Before declaring the work complete, review the application against this brief and the supplied reference material, identify any material assumptions or limitations that remain, and report them clearly rather than presenting uncertain behaviour as established FrostLine policy.

Deliver the strongest working version you can within the session. Continue autonomously through analysis, implementation, testing and fix-up until you reach a natural completed state.