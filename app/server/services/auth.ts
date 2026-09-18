import crypto from "node:crypto";
import { getDb } from "../db.js";
import { AppError } from "../errors.js";
import { Actor, permissionsFor, Role } from "../permissions.js";
import { now } from "../time.js";

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verify(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

export function login(email: string, password: string) {
  const u = getDb().prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email ?? "") as any;
  if (!u || !u.active || !verify(password ?? "", u.password_hash)) throw new AppError(401, "bad_credentials", "Email or password is incorrect");
  const token = crypto.randomBytes(24).toString("hex");
  getDb().prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, u.id, now());
  return { token, user: publicUser(u) };
}

export function logout(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function userForToken(token: string | undefined): Actor | null {
  if (!token) return null;
  const u = getDb().prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1").get(token) as any;
  return u ? { id: u.id, name: u.name, role: u.role as Role, via: "ui" } : null;
}

export function publicUser(u: any) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    job_title: u.job_title,
    permissions: permissionsFor(u.role),
  };
}

export function me(actor: Actor) {
  const u = getDb().prepare("SELECT * FROM users WHERE id = ?").get(actor.id) as any;
  return publicUser(u);
}

export function demoUsers() {
  return getDb().prepare("SELECT name, email, role, job_title FROM users WHERE active = 1 ORDER BY CASE role WHEN 'manager' THEN 0 WHEN 'coordinator' THEN 1 WHEN 'sales' THEN 2 ELSE 3 END, name").all();
}

export function listUsers() {
  return (getDb().prepare("SELECT id, name, email, role, job_title, phone, active, skills, base_region, is_subcontractor FROM users ORDER BY role, name").all() as any[]).map((u) => ({ ...u, skills: JSON.parse(u.skills) }));
}
