import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { dryRun, getDb } from "../db.js";
import { AppError, conflict, forbidden, notFound } from "../errors.js";
import { Actor, require } from "../permissions.js";
import { now } from "../time.js";
import { logActivity } from "../services/activity.js";
import { getSetting } from "../services/settings.js";
import { getCustomer, getEquipment, getSite, searchCustomers, customerHistory } from "../services/customers.js";
import { dateContext, toolByName, toolsFor } from "./tools.js";

type MessageParam = Anthropic.Beta.BetaMessageParam;

export const AI_MODEL = process.env.FROSTLINE_AI_MODEL ?? "claude-opus-5";
const EFFORT = (process.env.FROSTLINE_AI_EFFORT ?? "medium") as "low" | "medium" | "high";
const MAX_STEPS = 10;

/** Minimal surface of the SDK we use, so tests can inject a scripted fake. */
export interface AiClient {
  beta: {
    messages: {
      create(params: any): Promise<any>;
      parse(params: any): Promise<any>;
    };
  };
}

let client: AiClient | null = null;
let clientOverride = false;

export function setAiClient(c: AiClient | null) {
  client = c;
  clientOverride = !!c;
}

export function aiStatus() {
  if (process.env.FROSTLINE_AI === "off") return { enabled: false, reason: "AI features are switched off (FROSTLINE_AI=off)." };
  if (clientOverride) return { enabled: true, model: AI_MODEL };
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && process.env.FROSTLINE_AI !== "on") {
    return { enabled: false, reason: "AI is not configured. Set ANTHROPIC_API_KEY (or FROSTLINE_AI=on with an `ant auth login` profile) and restart. Everything else works without it." };
  }
  return { enabled: true, model: AI_MODEL };
}

function getClient(): AiClient {
  const s = aiStatus();
  if (!s.enabled) throw new AppError(503, "ai_unavailable", s.reason!);
  if (!client) client = new Anthropic() as unknown as AiClient;
  return client;
}

// Refusal fallbacks: on a policy decline the API re-runs the request on Anthropic's recommended fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

function systemPrompt(actor: Actor) {
  const labourRate = getSetting<number | null>("labour_rate");
  const stable = `You are the operations assistant inside FrostLine's CRM. Frostline Mechanical Services is a commercial HVAC contractor (air conditioning, heating, ventilation, refrigeration; planned maintenance, reactive repair, installation) based in Greater Manchester, working mainly across Greater Manchester, Lancashire, Merseyside, Cheshire and West Yorkshire.

You help office staff get operational work done quickly: finding customers and history, logging jobs from phone calls or emails, working out who can attend, booking visits, and drafting quotes.

How to work:
- Use the tools to look things up. Never invent ids, names, prices, response times, contract terms or availability. If something is ambiguous (e.g. several matching customers or sites), ask a short clarifying question or present the options.
- Actions that change data (create_job, schedule_visit, reschedule_visit, create_quote_draft, add_job_note, put_job_on_hold, create_customer) are PROPOSALS. The user sees a confirmation card and decides. After proposing, say clearly what you have proposed and that it needs their confirmation. Never say an action has been done unless a later message confirms it was executed.
- The system applies business rules itself (contract cover, response targets, scheduling conflicts, permissions). If a proposal is rejected with an error, explain it plainly and suggest what to do.
- When choosing an engineer, use suggest_engineers and explain the trade-offs briefly (availability, skills, site familiarity, region). Surface any scheduling issues before acknowledging them.
- Company-specific policy is often not recorded. If a decision depends on policy that isn't in the data (pricing, priorities, whether to attend out of hours), say so rather than assuming.
- Be concise. Use short paragraphs or bullet lists. Refer to records by their reference (e.g. J-10012, Q-20003).`;
  const volatile = `Current user: ${actor.name} (${actor.role}). Current UK local time: ${now().replace("T", " ")}. Upcoming dates: ${dateContext()}.
Configured default labour rate for quotes: ${labourRate == null ? "not configured — leave labour unpriced (0) and flag it" : `£${labourRate}/hour (a configurable setting)`}.`;
  return [
    { type: "text" as const, text: stable, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: volatile },
  ];
}

function toolParams(actor: Actor): Anthropic.Beta.BetaTool[] {
  return toolsFor(actor).map((t) => {
    const schema = z.toJSONSchema(t.schema, { io: "input" }) as any;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema };
  });
}

function loadConversation(actor: Actor, id: number) {
  const c = getDb().prepare("SELECT * FROM ai_conversations WHERE id = ?").get(id) as any;
  if (!c) throw notFound("Conversation");
  if (c.user_id !== actor.id) throw forbidden("That conversation belongs to another user");
  return { ...c, messages: JSON.parse(c.messages) as MessageParam[] };
}

export function listConversations(actor: Actor) {
  return getDb().prepare("SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30").all(actor.id);
}

export function getConversation(actor: Actor, id: number) {
  const c = loadConversation(actor, id);
  const actions = getDb().prepare("SELECT * FROM ai_actions WHERE conversation_id = ? ORDER BY id").all(id).map(actionView);
  return { id: c.id, title: c.title, transcript: transcript(c.messages), actions };
}

/** Flatten stored API messages into what the chat panel shows. */
function transcript(messages: MessageParam[]) {
  const out: { role: "user" | "assistant"; text: string; tools?: string[] }[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role as any, text: m.content });
      continue;
    }
    const texts = m.content.filter((b: any) => b.type === "text").map((b: any) => b.text as string);
    const tools = m.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.name as string);
    if (m.role === "user") {
      const visible = texts.filter((t) => !t.startsWith("[System note"));
      if (visible.length) out.push({ role: "user", text: visible.join("\n") });
    } else if (texts.length || tools.length) {
      const last = out[out.length - 1];
      if (last?.role === "assistant" && !last.text) {
        last.text = texts.join("\n");
        last.tools = [...(last.tools ?? []), ...tools];
      } else out.push({ role: "assistant", text: texts.join("\n"), tools });
    }
  }
  return out.filter((m) => m.text || m.tools?.length);
}

function actionView(a: any) {
  return { ...a, input: JSON.parse(a.input), result: a.result ? JSON.parse(a.result) : null, preview: a.preview ? JSON.parse(a.preview) : null };
}

function compact(value: unknown, limit = 12000) {
  const s = JSON.stringify(value);
  return s.length > limit ? s.slice(0, limit) + "…(truncated)" : s;
}

export interface AssistantTurn {
  conversation_id: number;
  reply: string;
  tools_used: { name: string; ok: boolean }[];
  actions: any[];
}

export async function chat(actor: Actor, conversationId: number | null, text: string, context?: string | null): Promise<AssistantTurn> {
  require(actor, "ai.use");
  const ai = getClient();
  const db = getDb();
  const t = now();
  let conv: { id: number; messages: MessageParam[] };
  if (conversationId) conv = loadConversation(actor, conversationId);
  else {
    const r = db.prepare("INSERT INTO ai_conversations (user_id, title, messages, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)").run(actor.id, text.slice(0, 80), t, t);
    conv = { id: Number(r.lastInsertRowid), messages: [] };
  }

  // Tell the model what happened to its earlier proposals since the last turn.
  const decided = db
    .prepare("SELECT * FROM ai_actions WHERE conversation_id = ? AND status != 'proposed' AND decided_at IS NOT NULL AND decided_at >= COALESCE((SELECT updated_at FROM ai_conversations WHERE id = ?), '')")
    .all(conv.id, conv.id) as any[];
  const notes = decided.map((a) => `[System note: proposed action #${a.id} (${a.tool}) was ${a.status}${a.status === "executed" ? `; result: ${compact(JSON.parse(a.result ?? "null"), 400)}` : a.error ? `: ${a.error}` : " by the user"}]`);
  const userContent: any[] = [...notes.map((n) => ({ type: "text", text: n }))];
  if (context) userContent.push({ type: "text", text: `[System note: the user is currently viewing ${context}]` });
  userContent.push({ type: "text", text });
  conv.messages.push({ role: "user", content: userContent });

  const tools = toolParams(actor);
  const toolsUsed: { name: string; ok: boolean }[] = [];
  const proposed: number[] = [];
  const aiActor: Actor = { ...actor, via: "ai" };
  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await ai.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      system: systemPrompt(actor),
      tools,
      messages: conv.messages,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      ...FALLBACK,
    });
    conv.messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "refusal") {
      reply = "I can't help with that request.";
      break;
    }
    if (response.stop_reason === "pause_turn") continue;
    const toolUses = response.content.filter((b: any) => b.type === "tool_use");
    reply = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    if (response.stop_reason !== "tool_use" || !toolUses.length) break;

    const results: any[] = [];
    for (const use of toolUses) {
      const def = toolByName(use.name);
      let content: string;
      let isError = false;
      try {
        if (!def || !toolsFor(actor).includes(def)) throw forbidden(`Tool ${use.name} is not available to your role`);
        const parsed = def.schema.safeParse(use.input);
        if (!parsed.success) throw new AppError(400, "invalid", `Invalid tool input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        if (def.kind === "read") {
          content = compact(def.run(actor, parsed.data));
        } else {
          // Validate against real business rules without committing anything.
          const preview = dryRun(db, () => def.run(aiActor, parsed.data)) as any;
          const summary = def.describe ? def.describe(parsed.data) : def.name;
          const r = db
            .prepare("INSERT INTO ai_actions (conversation_id, user_id, tool, input, summary, preview, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?)")
            .run(conv.id, actor.id, def.name, JSON.stringify(parsed.data), summary, JSON.stringify({ warnings: preview?.warnings ?? [], overridden: preview?.overridden ?? [] }), now());
          proposed.push(Number(r.lastInsertRowid));
          content = compact({
            status: "proposed — awaiting user confirmation (not yet done)",
            action_id: Number(r.lastInsertRowid),
            summary,
            warnings: preview?.warnings ?? [],
            acknowledged_issues: preview?.overridden ?? [],
          });
        }
      } catch (e: any) {
        isError = true;
        const details = e instanceof AppError && e.details ? ` ${compact(e.details, 2000)}` : "";
        content = e instanceof AppError ? `${e.code}: ${e.message}${details}` : `error: ${e?.message ?? String(e)}`;
      }
      toolsUsed.push({ name: use.name, ok: !isError });
      results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
    }
    conv.messages.push({ role: "user", content: results });
    if (step === MAX_STEPS - 1) reply ||= "I stopped after several steps without finishing — please narrow the request.";
  }

  db.prepare("UPDATE ai_conversations SET messages = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(conv.messages), now(), conv.id);
  const actions = proposed.length ? (db.prepare(`SELECT * FROM ai_actions WHERE id IN (${proposed.join(",")})`).all() as any[]).map(actionView) : [];
  return { conversation_id: conv.id, reply, tools_used: toolsUsed, actions };
}

/** The user confirms a proposed action: it is re-validated and executed as them, marked as AI-initiated. */
export function confirmAction(actor: Actor, id: number) {
  const db = getDb();
  const a = db.prepare("SELECT * FROM ai_actions WHERE id = ?").get(id) as any;
  if (!a) throw notFound("Proposed action");
  if (a.user_id !== actor.id) throw forbidden("Only the user who asked for this action can confirm it");
  if (a.status !== "proposed") throw conflict(`This action was already ${a.status}`);
  const def = toolByName(a.tool);
  if (!def) throw notFound("Tool");
  const input = JSON.parse(a.input);
  try {
    const result = db.transaction(() => {
      const r = def.run({ ...actor, via: "ai" }, def.schema.parse(input));
      db.prepare("UPDATE ai_actions SET status = 'executed', result = ?, decided_at = ? WHERE id = ?").run(JSON.stringify(summariseResult(r)), now(), id);
      return r;
    })();
    logActivity({ ...actor, via: "ai" }, "ai.action_confirmed", `Confirmed assistant action: ${a.summary}`, refsFromResult(result));
    return actionView(db.prepare("SELECT * FROM ai_actions WHERE id = ?").get(id));
  } catch (e: any) {
    db.prepare("UPDATE ai_actions SET status = 'failed', error = ?, decided_at = ? WHERE id = ?").run(e?.message ?? String(e), now(), id);
    throw e;
  }
}

export function rejectAction(actor: Actor, id: number) {
  const db = getDb();
  const a = db.prepare("SELECT * FROM ai_actions WHERE id = ?").get(id) as any;
  if (!a) throw notFound("Proposed action");
  if (a.user_id !== actor.id) throw forbidden();
  if (a.status !== "proposed") throw conflict(`This action was already ${a.status}`);
  db.prepare("UPDATE ai_actions SET status = 'rejected', decided_at = ? WHERE id = ?").run(now(), id);
  return actionView(db.prepare("SELECT * FROM ai_actions WHERE id = ?").get(id));
}

function summariseResult(r: any) {
  if (!r || typeof r !== "object") return r;
  const keys = ["id", "reference", "revision", "status", "job_id", "engineer_name", "scheduled_start", "scheduled_end", "customer_id", "account_ref", "site_id", "warnings", "ok"];
  return Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
}

function refsFromResult(r: any) {
  if (!r || typeof r !== "object") return {};
  return { job_id: r.job_id ?? (r.reference?.startsWith?.("J-") ? r.id : undefined), customer_id: r.customer_id, site_id: r.site_id, quote_id: r.reference?.startsWith?.("Q-") ? r.id : undefined, visit_id: r.scheduled_start ? r.id : undefined };
}

// ---------- single-shot AI helpers used inside normal screens ----------

async function textCall(prompt: string, system: string) {
  const ai = getClient();
  const response = await ai.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    system,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
    ...FALLBACK,
  });
  if (response.stop_reason === "refusal") throw new AppError(422, "ai_refused", "The assistant declined this request");
  return response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

/** Operational briefing for a customer, site or asset — condenses history spread across many screens. */
export async function summarise(actor: Actor, kind: "customer" | "site" | "equipment", id: number) {
  require(actor, "ai.use");
  let data: unknown;
  if (kind === "customer") data = { ...getCustomer(actor, id), history: customerHistory(actor, id) };
  else if (kind === "site") data = getSite(actor, id);
  else data = getEquipment(actor, id);
  const text = await textCall(
    `Write a short operational briefing (max ~180 words) about this ${kind} for a service coordinator or engineer about to deal with them. Cover: current state, recurring faults or patterns, open issues (jobs, holds, recommendations, quotes), contract/cover points and anything unusual (account hold, access restrictions, warranty, F-gas). Use bullet points. Only use the data given; say "not recorded" rather than guessing.\n\nDATA:\n${compact(data, 60000)}`,
    "You summarise CRM records for a UK commercial HVAC contractor. Be factual and brief. Refer to records by reference.",
  );
  return { summary: text, generated_at: now(), model: AI_MODEL };
}

const EmailExtraction = z.object({
  customer_search: z.string().describe("Best search term to find the customer (organisation name, or site name/postcode if that is all there is)"),
  site_hint: z.string().nullable().describe("Site name, address or postcode mentioned, if any"),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  contact_email: z.string().nullable(),
  title: z.string().describe("Short job title, e.g. 'Server room AC unit not cooling'"),
  description: z.string().describe("Fault description for the engineer, including symptoms, location in building, access notes and anything the customer asked for"),
  suggested_priority: z.enum(["emergency", "urgent", "routine"]),
  priority_reason: z.string().describe("Why this priority was suggested, citing the email"),
  equipment_hint: z.string().nullable().describe("Equipment mentioned (make/model/asset tag/location)"),
  customer_order_ref: z.string().nullable(),
});

/** Turn a pasted customer email into a pre-filled job form (the user reviews and submits it). */
export async function extractJobFromEmail(actor: Actor, emailText: string) {
  require(actor, "job.create");
  require(actor, "ai.use");
  const ai = getClient();
  const response = await ai.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 4000,
    system: "You extract fault reports for a UK commercial HVAC contractor from customer emails. Only use what the email says. The priority is only a suggestion for a human to confirm.",
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: betaZodOutputFormat(EmailExtraction) },
    messages: [{ role: "user", content: `EMAIL:\n${emailText.slice(0, 20000)}` }],
    ...FALLBACK,
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new AppError(422, "ai_failed", "Could not read that email");
  const x = response.parsed_output as z.infer<typeof EmailExtraction>;
  const customers = searchCustomers(actor, { query: x.customer_search, limit: 5 }) as any[];
  // Also try the site hint, which often identifies the customer when the sender uses a site name.
  if (!customers.length && x.site_hint) customers.push(...(searchCustomers(actor, { query: x.site_hint, limit: 5 }) as any[]));
  return { extraction: x, customer_candidates: customers.map((c) => ({ id: c.id, name: c.name, account_ref: c.account_ref })) };
}
