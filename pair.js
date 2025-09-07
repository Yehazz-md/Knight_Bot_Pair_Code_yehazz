// api/pair.js
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import PhoneNumber from "awesome-phonenumber";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create session folder in /tmp (Vercel only allows /tmp write)
function makeSessionDir(sessionId) {
  const base = "/tmp";
  const dir = path.join(base, `session_${sessionId}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Normalize number to WhatsApp-friendly format
function normalizeNumber(input) {
  try {
    const pn = new PhoneNumber(input, "LK"); // default region LK (Sri Lanka) - change if needed
    if (pn.isValid()) {
      const e164 = pn.getNumber("e164"); // +94771234567
      return e164.replace(/\D/g, ""); // 94771234567
    }
  } catch {}
  // fallback - strip non-digits
  return String(input).replace(/\D/g, "").replace(/^0+/, "");
}

// Parse JSON body safely
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { number } = await parseBody(req);
    if (!number) {
      return res.status(400).json({ error: "Missing 'number' in body" });
    }

    const phone = normalizeNumber(number);
    if (!phone || phone.length < 6) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }

    const sessionId = `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 9)}`;
    const sessionDir = makeSessionDir(sessionId);
