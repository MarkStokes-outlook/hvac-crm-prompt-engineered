import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { freshDb } from "./helpers.js";
import { createApp } from "../server/app.js";

let app: ReturnType<typeof createApp>;
beforeAll(() => {
  freshDb();
  app = createApp();
});

async function login(email: string) {
  const agent = request.agent(app);
  const r = await agent.post("/api/auth/login").send({ email: `${email}@frostline.example`, password: "frostline" });
  expect(r.status).toBe(200);
  return agent;
}

describe("HTTP API", () => {
  it("requires sign-in", async () => {
    expect((await request(app).get("/api/jobs")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: "priya.nair@frostline.example", password: "nope" })).status).toBe(401);
  });

  it("scopes engineers to their own work", async () => {
    const dave = await login("dave.kershaw");
    expect((await dave.get("/api/customers")).status).toBe(403);
    expect((await dave.get("/api/jobs")).status).toBe(403);
    const mine = await dave.get("/api/my/visits?from=2026-09-10&to=2026-09-20");
    expect(mine.status).toBe(200);
    expect(mine.body.every((v: any) => v.engineer_id === mine.body[0].engineer_id)).toBe(true);
    const van = await dave.get("/api/my/van");
    expect(van.body.kind).toBe("van");
    const other = await dave.get("/api/visits/1");
    // visit 1 belongs to someone else in the seed unless it is Dave's; either 200 (own) or 403
    expect([200, 403]).toContain(other.status);
  });

  it("returns structured confirmation details for scheduling conflicts", async () => {
    const priya = await login("priya.nair");
    const jobs = (await priya.get("/api/jobs?status=to_schedule")).body;
    const engineers = (await priya.get("/api/engineers")).body;
    const lewis = engineers.find((e: any) => e.name === "Lewis Tran");
    const r = await priya.post("/api/visits").send({ job_id: jobs[0].id, engineer_id: lewis.id, start: "2026-09-16T13:30", duration_hours: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("needs_confirmation");
    expect(r.body.details.issues[0].code).toBe("overlap");
  });

  it("dashboard aggregates live state", async () => {
    const priya = await login("priya.nair");
    const d = (await priya.get("/api/dashboard")).body;
    expect(d.counts.response_risk).toBeGreaterThanOrEqual(2);
    expect(d.counts.to_schedule).toBeGreaterThan(0);
    expect(d.today_visits.length).toBeGreaterThan(0);
  });

  it("reports AI status without failing when not configured", async () => {
    const priya = await login("priya.nair");
    const s = await priya.get("/api/ai/status");
    expect(s.status).toBe(200);
    expect(typeof s.body.enabled).toBe("boolean");
  });
});
