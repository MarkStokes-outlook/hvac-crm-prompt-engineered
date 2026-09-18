import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { UPLOAD_DIR } from "./db.js";
import { AppError, forbidden } from "./errors.js";
import { Actor, can, require as requirePerm } from "./permissions.js";
import { now, today, addDays } from "./time.js";
import * as auth from "./services/auth.js";
import * as customers from "./services/customers.js";
import * as jobs from "./services/jobs.js";
import * as visits from "./services/visits.js";
import * as quotes from "./services/quotes.js";
import * as contracts from "./services/contracts.js";
import * as stock from "./services/stock.js";
import * as settings from "./services/settings.js";
import { listActivity } from "./services/activity.js";
import { officeDashboard } from "./services/dashboard.js";
import * as ai from "./ai/agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor: Actor;
    }
  }
}

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};
const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));
const idParam = (req: Request, name = "id") => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, "invalid", `Bad ${name}`);
  return n;
};

export function createApp(opts: { serveClient?: boolean } = {}) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  const api = express.Router();

  // ---- public ----
  api.post("/auth/login", h((req, res) => {
    const { token, user } = auth.login(req.body?.email, req.body?.password);
    res.cookie("fl_session", token, { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 14 });
    return user;
  }));
  api.get("/auth/demo-users", h(() => auth.demoUsers()));
  api.get("/health", h(() => ({ ok: true, time: now() })));

  // ---- authenticated ----
  api.use((req, _res, next) => {
    const actor = auth.userForToken(req.cookies?.fl_session);
    if (!actor) return next(new AppError(401, "unauthenticated", "Please sign in"));
    req.actor = actor;
    next();
  });
  api.post("/auth/logout", h((req, res) => {
    auth.logout(req.cookies.fl_session);
    res.clearCookie("fl_session");
    return { ok: true };
  }));
  api.get("/auth/me", h((req) => ({ ...auth.me(req.actor), ai: ai.aiStatus() })));

  api.get("/dashboard", h((req) => officeDashboard(req.actor)));
  api.get("/users", h((req) => {
    requirePerm(req.actor, "users.read");
    return auth.listUsers();
  }));
  api.get("/engineers", h((req) => {
    requirePerm(req.actor, "schedule.read");
    return visits.engineers();
  }));

  // customers / sites / equipment
  api.get("/customers", h((req) => customers.searchCustomers(req.actor, { query: req.query.q as string, status: req.query.status as string, limit: num(req.query.limit) })));
  api.post("/customers", h((req) => customers.createCustomer(req.actor, req.body)));
  api.get("/customers/:id", h((req) => customers.getCustomer(req.actor, idParam(req))));
  api.patch("/customers/:id", h((req) => customers.updateCustomer(req.actor, idParam(req), req.body)));
  api.post("/customers/:id/account-hold", h((req) => customers.setAccountHold(req.actor, idParam(req), !!req.body?.hold, req.body?.note)));
  api.get("/customers/:id/history", h((req) => customers.customerHistory(req.actor, idParam(req))));
  api.get("/customers/:id/activity", h((req) => {
    requirePerm(req.actor, "customer.read");
    return listActivity({ customer_id: idParam(req), limit: 200 });
  }));
  api.post("/contacts", h((req) => customers.createContact(req.actor, req.body)));
  api.patch("/contacts/:id", h((req) => customers.updateContact(req.actor, idParam(req), req.body)));
  api.post("/sites", h((req) => customers.createSite(req.actor, req.body)));
  api.get("/sites/:id", h((req) => customers.getSite(req.actor, idParam(req))));
  api.patch("/sites/:id", h((req) => customers.updateSite(req.actor, idParam(req), req.body)));
  api.get("/equipment-categories", h(() => customers.listEquipmentCategories()));
  api.post("/equipment", h((req) => customers.createEquipment(req.actor, req.body)));
  api.get("/equipment/:id", h((req) => customers.getEquipment(req.actor, idParam(req))));
  api.patch("/equipment/:id", h((req) => customers.updateEquipment(req.actor, idParam(req), req.body)));

  // contracts
  api.get("/contracts", h((req) => contracts.listContracts(req.actor, { customer_id: num(req.query.customer_id) })));
  api.post("/contracts", h((req) => contracts.createContract(req.actor, req.body)));
  api.get("/contracts/:id", h((req) => contracts.getContract(req.actor, idParam(req))));
  api.patch("/contracts/:id", h((req) => contracts.updateContract(req.actor, idParam(req), req.body)));
  api.post("/contracts/:id/generate-ppm", h((req) => contracts.generatePlannedMaintenance(req.actor, idParam(req), req.body?.from, req.body?.to)));

  // jobs
  api.get("/jobs", h((req) =>
    jobs.listJobs(req.actor, {
      status: req.query.status as string,
      job_type: req.query.job_type as string,
      priority: req.query.priority as string,
      customer_id: num(req.query.customer_id),
      site_id: num(req.query.site_id),
      engineer_id: num(req.query.engineer_id),
      query: req.query.q as string,
      response: req.query.response as string,
    }),
  ));
  api.post("/jobs", h((req) => jobs.createJob(req.actor, req.body)));
  api.get("/jobs/preview", h((req) => jobs.previewJob(req.actor, Number(req.query.site_id), String(req.query.job_type), String(req.query.priority))));
  api.get("/jobs/:id", h((req) => jobs.getJob(req.actor, idParam(req))));
  api.patch("/jobs/:id", h((req) => jobs.updateJob(req.actor, idParam(req), req.body)));
  api.post("/jobs/:id/notes", h((req) => jobs.addJobNote(req.actor, idParam(req), req.body?.note)));
  api.post("/jobs/:id/hold", h((req) => jobs.holdJob(req.actor, idParam(req), req.body?.reason, req.body?.note)));
  api.post("/jobs/:id/release", h((req) => jobs.releaseHold(req.actor, idParam(req), req.body?.note)));
  api.post("/jobs/:id/cancel", h((req) => jobs.cancelJob(req.actor, idParam(req), req.body?.reason)));
  api.post("/jobs/:id/complete", h((req) => jobs.completeJob(req.actor, idParam(req), req.body?.note)));
  api.post("/jobs/:id/reopen", h((req) => jobs.reopenJob(req.actor, idParam(req), req.body?.reason)));
  api.post("/jobs/:id/close", h((req) => jobs.closeJob(req.actor, idParam(req), req.body?.note)));
  api.get("/jobs/:id/suggest-engineers", h((req) => visits.suggestEngineers(req.actor, idParam(req), (req.query.date as string) ?? today(), num(req.query.hours))));
  api.post("/job-parts/:id/available", h((req) => stock.markJobPartAvailable(req.actor, idParam(req), num(req.body?.location_id))));

  // scheduling & visits
  api.get("/schedule", h((req) => visits.scheduleBoard(req.actor, (req.query.from as string) ?? today(), num(req.query.days) ?? 1)));
  api.post("/visits", h((req) => visits.scheduleVisit(req.actor, req.body)));
  api.post("/visits/check", h((req) => {
    requirePerm(req.actor, "schedule.read");
    return { issues: visits.checkSlot(req.body.job_id, req.body.engineer_id, req.body.start, req.body.end, req.body.visit_id) };
  }));
  api.get("/visits/:id", h((req) => visits.getVisitDetail(req.actor, idParam(req))));
  api.patch("/visits/:id", h((req) => visits.rescheduleVisit(req.actor, idParam(req), req.body)));
  api.post("/visits/:id/cancel", h((req) => visits.cancelVisit(req.actor, idParam(req), req.body?.reason)));
  api.post("/visits/:id/travel", h((req) => visits.startTravel(req.actor, idParam(req))));
  api.post("/visits/:id/arrive", h((req) => visits.arrive(req.actor, idParam(req))));
  api.put("/visits/:id/notes", h((req) => visits.saveNotes(req.actor, idParam(req), req.body)));
  api.put("/visits/:id/checks", h((req) => visits.recordEquipmentCheck(req.actor, idParam(req), req.body)));
  api.post("/visits/:id/parts", h((req) => visits.addVisitPart(req.actor, idParam(req), req.body)));
  api.delete("/visits/:id/parts/:lineId", h((req) => visits.removeVisitPart(req.actor, idParam(req), idParam(req, "lineId"))));
  api.post("/visits/:id/photos", upload.single("photo"), h((req) => {
    if (!req.file) throw new AppError(400, "invalid", "No photo uploaded");
    return visits.addPhoto(req.actor, idParam(req), req.file, req.body?.caption, num(req.body?.equipment_id));
  }));
  api.post("/visits/:id/recommendations", h((req) => visits.addRecommendation(req.actor, idParam(req), req.body)));
  api.post("/visits/:id/complete", h((req) => visits.completeVisit(req.actor, idParam(req), req.body)));
  api.get("/my/visits", h((req) => {
    const from = (req.query.from as string) ?? today();
    return visits.myVisits(req.actor, from, (req.query.to as string) ?? addDays(from, 6));
  }));
  api.get("/my/van", h((req) => {
    const van = stock.vanForEngineer(req.actor.id);
    if (!van) throw new AppError(404, "not_found", "You have no van stock location");
    return stock.locationStock(req.actor, van.id);
  }));
  api.post("/absences", h((req) => visits.createAbsence(req.actor, req.body)));
  api.delete("/absences/:id", h((req) => visits.deleteAbsence(req.actor, idParam(req))));

  // quotes & recommendations
  api.get("/quotes", h((req) => quotes.listQuotes(req.actor, { status: req.query.status as string, customer_id: num(req.query.customer_id), query: req.query.q as string })));
  api.post("/quotes", h((req) => quotes.createQuote(req.actor, req.body)));
  api.get("/quotes/:id", h((req) => quotes.getQuote(req.actor, idParam(req))));
  api.patch("/quotes/:id", h((req) => quotes.updateQuote(req.actor, idParam(req), req.body)));
  api.post("/quotes/:id/send", h((req) => quotes.sendQuote(req.actor, idParam(req))));
  api.post("/quotes/:id/accept", h((req) => quotes.acceptQuote(req.actor, idParam(req), req.body)));
  api.post("/quotes/:id/reject", h((req) => quotes.rejectQuote(req.actor, idParam(req), req.body?.reason, req.body?.by_name)));
  api.post("/quotes/:id/withdraw", h((req) => quotes.withdrawQuote(req.actor, idParam(req), req.body?.reason ?? "")));
  api.post("/quotes/:id/revise", h((req) => quotes.reviseQuote(req.actor, idParam(req))));
  api.post("/quotes/:id/convert", h((req) => quotes.convertQuote(req.actor, idParam(req))));
  api.get("/recommendations", h((req) => quotes.listRecommendations(req.actor, (req.query.status as string) ?? "open")));
  api.post("/recommendations/:id/dismiss", h((req) => quotes.dismissRecommendation(req.actor, idParam(req), req.body?.reason)));

  // stock
  api.get("/stock/locations", h((req) => stock.listLocations(req.actor)));
  api.get("/stock/locations/:id", h((req) => stock.locationStock(req.actor, idParam(req))));
  api.get("/parts", h((req) => stock.searchParts(req.actor, { query: req.query.q as string, location_id: num(req.query.location_id) })));
  api.post("/parts", h((req) => stock.createPart(req.actor, req.body)));
  api.patch("/parts/:id", h((req) => stock.updatePart(req.actor, idParam(req), req.body)));
  api.get("/stock/reorder", h((req) => stock.reorderSuggestions(req.actor)));
  api.post("/stock/transfer", h((req) => stock.transferStock(req.actor, req.body)));
  api.post("/stock/adjust", h((req) => stock.adjustStock(req.actor, req.body)));
  api.post("/stock/min", h((req) => stock.setMinQuantity(req.actor, req.body?.part_id, req.body?.location_id, req.body?.min_quantity)));
  api.get("/suppliers", h((req) => stock.listSuppliers(req.actor)));
  api.get("/purchase-orders", h((req) => stock.listPurchaseOrders(req.actor, req.query.status as string)));
  api.post("/purchase-orders", h((req) => stock.createPurchaseOrder(req.actor, req.body)));
  api.get("/purchase-orders/:id", h((req) => stock.getPurchaseOrder(req.actor, idParam(req))));
  api.post("/purchase-orders/:id/order", h((req) => stock.markOrdered(req.actor, idParam(req), req.body?.supplier_ref, req.body?.expected_date)));
  api.post("/purchase-orders/:id/receive", h((req) => stock.receivePurchaseOrder(req.actor, idParam(req), req.body)));
  api.post("/purchase-orders/:id/cancel", h((req) => stock.cancelPurchaseOrder(req.actor, idParam(req), req.body?.reason ?? "")));

  // settings & audit
  api.get("/settings", h((req) => {
    if (!can(req.actor, "settings.manage") && !can(req.actor, "job.read")) throw forbidden();
    return settings.listSettings();
  }));
  api.put("/settings", h((req) => settings.updateSettings(req.actor, req.body ?? {})));
  api.get("/activity", h((req) => {
    requirePerm(req.actor, "audit.read");
    return listActivity({ via: req.query.via as string, limit: num(req.query.limit) ?? 200 });
  }));

  // AI
  api.get("/ai/status", h(() => ai.aiStatus()));
  api.get("/ai/conversations", h((req) => ai.listConversations(req.actor)));
  api.get("/ai/conversations/:id", h((req) => ai.getConversation(req.actor, idParam(req))));
  api.post("/ai/chat", h((req) => ai.chat(req.actor, num(req.body?.conversation_id) ?? null, String(req.body?.message ?? ""), req.body?.context)));
  api.post("/ai/actions/:id/confirm", h((req) => ai.confirmAction(req.actor, idParam(req))));
  api.post("/ai/actions/:id/reject", h((req) => ai.rejectAction(req.actor, idParam(req))));
  api.post("/ai/summarise", h((req) => ai.summarise(req.actor, req.body?.kind, Number(req.body?.id))));
  api.post("/ai/email-to-job", h((req) => ai.extractJobFromEmail(req.actor, String(req.body?.text ?? ""))));

  // uploaded photos/signatures: any signed-in user (photos are referenced from records they can see)
  api.get("/uploads/:name", (req, res, next) => {
    const name = path.basename(req.params.name);
    const file = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(file)) return next(new AppError(404, "not_found", "File not found"));
    res.sendFile(file);
  });

  app.use("/api", api);

  if (opts.serveClient) {
    const dist = path.resolve(here, "../dist");
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    if (err?.status && err?.error) {
      // Anthropic SDK errors
      return res.status(502).json({ error: "ai_error", message: `AI service error: ${err.message}` });
    }
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Unexpected server error" });
  });
  return app;
}
