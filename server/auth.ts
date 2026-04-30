import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";

const DEFAULT_PASSWORD = "kayur2026";
const COOKIE_NAME = "kpf_session";
const SESSION_DAYS = 30;

export function getPasswordHash(): string {
  let hash = process.env.APP_PASSWORD_HASH;
  if (!hash) {
    const stored = storage.getSetting("password_hash");
    if (stored) return stored;
    hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    storage.setSetting("password_hash", hash);
    console.log("[auth] No APP_PASSWORD_HASH env var. Generated default hash for 'kayur2026'.");
  }
  return hash;
}

export function getSessionSecret(): string {
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    const stored = storage.getSetting("session_secret");
    if (stored) return stored;
    secret = Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
    storage.setSetting("session_secret", secret);
  }
  return secret;
}

export function verifyPassword(input: string): boolean {
  return bcrypt.compareSync(input, getPasswordHash());
}

export function setPassword(newPassword: string) {
  const hash = bcrypt.hashSync(newPassword, 10);
  storage.setSetting("password_hash", hash);
}

export function issueToken(): string {
  return jwt.sign({ sub: "kayur" }, getSessionSecret(), { expiresIn: `${SESSION_DAYS}d` });
}

export function setSessionCookie(res: Response, token: string) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function getCookieName() {
  return COOKIE_NAME;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req as any).cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    jwt.verify(token, getSessionSecret());
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
}

export function isAuthed(req: Request): boolean {
  const token = (req as any).cookies?.[COOKIE_NAME];
  if (!token) return false;
  try {
    jwt.verify(token, getSessionSecret());
    return true;
  } catch {
    return false;
  }
}
