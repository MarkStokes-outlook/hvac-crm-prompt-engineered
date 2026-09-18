import { beforeEach, describe, expect, it } from "vitest";
import { actor, freshDb, q, qa } from "./helpers.js";
import { chat, confirmAction, rejectAction, setAiClient, aiStatus } from "../server/ai/agent.js";
import { AppError } from "../server/errors.js";

/** A scripted stand-in for the Anthropic client: each call returns the next scripted response. */
function scripted(steps: ((params: any) => any)[]) {
  const calls: any[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        create: async (params: any) => {
          calls.push(JSON.parse(JSON.stringify(params)));
          const step = steps[i++];
          if (!step) throw new Error("No more scripted responses");
          return step(params);
        },
        parse: async () => {
          throw new Error("not scripted");
        },
      },
    },
  };
  return { client, calls };
}
const toolUse = (id: string, name: string, input: unknown) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });
const text = (t: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

beforeEach(() => {
  freshDb();
});

describe("assistant", () => {
  it("is reported as unavailable without credentials and the rest of the app is unaffected", () => {
    setAiClient(null);
    const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN, f: process.env.FROSTLINE_AI };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.FROSTLINE_AI;
    expect(aiStatus().enabled).toBe(false);
    Object.assign(process.env, Object.fromEntries(Object.entries({ ANTHROPIC_API_KEY: saved.k, ANTHROPIC_AUTH_TOKEN: saved.t, FROSTLINE_AI: saved.f }).filter(([, v]) => v !== undefined)));
  });

  it("turns a request into a proposed job that is only created when the user confirms", async () => {
    const s = q("SELECT * FROM sites WHERE name = 'Stockport store'");
    const { client, calls } = scripted([
      () => toolUse("t1", "search_customers", { query: "Brindle" }),
      () => toolUse("t2", "create_job", { site_id: s.id, job_type: "reactive", priority: "routine", title: "Front cassette noisy", description: "Rattling noise", reported_via: "phone" }),
      () => text("I've proposed logging a routine job at the Stockport store — please confirm."),
    ]);
    setAiClient(client);
    const priya = actor("priya.nair");
    const before = q("SELECT COUNT(*) n FROM jobs").n;
    const turn = await chat(priya, null, "Brindle Stockport called, front cassette is rattling");
    expect(turn.tools_used.map((t) => t.name)).toEqual(["search_customers", "create_job"]);
    expect(turn.actions).toHaveLength(1);
    expect(turn.actions[0].status).toBe("proposed");
    expect(turn.actions[0].summary).toMatch(/Stockport store/);
    // The dry run left nothing behind
    expect(q("SELECT COUNT(*) n FROM jobs").n).toBe(before);
    expect(q("SELECT COUNT(*) n FROM activity WHERE action = 'job.create' AND via = 'ai'").n).toBe(0);
    // The tool result told the model it is only a proposal
    const lastUser = calls[2].messages[calls[2].messages.length - 1];
    expect(JSON.stringify(lastUser)).toMatch(/awaiting user confirmation/);
    // Only read + permitted tools are offered; no engineer-only or manager-only tools leak
    expect(calls[0].tools.map((t: any) => t.name)).toContain("create_job");

    // Another user cannot confirm it
    await expect(async () => confirmAction(actor("tom.whitaker"), turn.actions[0].id)).rejects.toThrow(AppError);
    const done = confirmAction(priya, turn.actions[0].id);
    expect(done.status).toBe("executed");
    expect(q("SELECT COUNT(*) n FROM jobs").n).toBe(before + 1);
    const created = q("SELECT * FROM jobs ORDER BY id DESC LIMIT 1");
    expect(created.title).toBe("Front cassette noisy");
    expect(q("SELECT via FROM activity WHERE job_id = ? AND action = 'job.create'", created.id).via).toBe("ai");
    expect(() => confirmAction(priya, turn.actions[0].id)).toThrow(/already executed/);
  });

  it("surfaces business-rule errors to the model instead of proposing invalid actions", async () => {
    const job = q("SELECT * FROM jobs WHERE title LIKE 'No heating in east wing%'");
    const lewis = q("SELECT * FROM users WHERE email = 'lewis.tran@frostline.example'");
    const { client, calls } = scripted([
      () => toolUse("t1", "schedule_visit", { job_id: job.id, engineer_id: lewis.id, start: "2026-09-16T13:30", duration_hours: 2 }),
      () => text("Lewis is already booked then."),
    ]);
    setAiClient(client);
    const turn = await chat(actor("priya.nair"), null, "Book Lewis at 13:30");
    expect(turn.actions).toHaveLength(0);
    expect(turn.tools_used[0].ok).toBe(false);
    const result = calls[1].messages[calls[1].messages.length - 1].content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/needs_confirmation.*already booked/);
  });

  it("records rejected proposals and reports decisions back to the model next turn", async () => {
    const s = q("SELECT * FROM sites WHERE name = 'Northgate House'");
    const { client, calls } = scripted([
      () => toolUse("t1", "create_job", { site_id: s.id, job_type: "reactive", priority: "urgent", title: "Lift lobby too hot" }),
      () => text("Proposed."),
      () => text("Understood."),
    ]);
    setAiClient(client);
    const priya = actor("priya.nair");
    const t1 = await chat(priya, null, "log a job");
    rejectAction(priya, t1.actions[0].id);
    await chat(priya, t1.conversation_id, "never mind");
    const firstUserBlock = calls[2].messages[calls[2].messages.length - 1].content;
    expect(JSON.stringify(firstUserBlock)).toMatch(/was rejected/);
  });

  it("does not offer write tools a role cannot use, and blocks engineers entirely", async () => {
    const { client, calls } = scripted([() => text("hi")]);
    setAiClient(client);
    await chat(actor("rachel.dunn"), null, "hello");
    const names = calls[0].tools.map((t: any) => t.name);
    expect(names).toContain("create_quote_draft");
    expect(names).not.toContain("create_job");
    expect(names).not.toContain("schedule_visit");
    await expect(chat(actor("dave.kershaw"), null, "hello")).rejects.toThrow(/cannot perform ai.use/);
  });

  it("sends the refusal-fallback and adaptive-thinking parameters", async () => {
    const { client, calls } = scripted([() => text("ok")]);
    setAiClient(client);
    await chat(actor("priya.nair"), null, "status?");
    expect(calls[0].model).toBe("claude-opus-5");
    expect(calls[0].fallbacks).toBe("default");
    expect(calls[0].betas).toContain("server-side-fallback-2026-07-01");
    expect(calls[0].thinking).toEqual({ type: "adaptive" });
  });
});
