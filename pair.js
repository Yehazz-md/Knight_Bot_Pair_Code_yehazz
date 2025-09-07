// api/pair.js
import fs from "fs";
import path from "path";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import PhoneNumber from "awesome-phonenumber";

// Clean phone number to E.164 format without "+"
function normalizeNumber(input) {
  try {
    const pn = new PhoneNumber(input);
    if (pn.isValid()) {
      return pn.getNumber("e164").replace("+", ""); // e.g. 94771234567
    }
  } catch {}
  return String(input).replace(/\D/g, "").replace(/^0+/, "");
}

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
      return res
        .status(400)
        .json({ error: "Invalid phone number. Please enter full international number." });
    }

    // Vercel allows only /tmp directory
    const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const sessionDir = path.join("/tmp", `session_${sessionId}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    const logger = pino({ level: "silent" });
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger,
      auth: state,
      printQRInTerminal: false,
      browser: ["Chrome (Vercel)", "Chrome", "121"],
    });

    sock.ev.on("creds.update", saveCreds);

    // Generate pairing code immediately if not registered
    if (!sock.authState.creds.registered) {
      try {
        const code = await sock.requestPairingCode(phone);
        console.log("[PAIR] Generated code:", code);

        return res.status(200).json({
          ok: true,
          code,
          sessionId,
          hint:
            "Open WhatsApp → Linked Devices → Link a Device → 'Link with phone number' and enter this code.",
        });
      } catch (err) {
        console.error("[PAIR] Error requesting code:", err);
        return res
          .status(503)
          .json({ error: "Failed to generate pairing code. Try again." });
      }
    } else {
      return res.status(200).json({
        ok: true,
        message: "This account is already registered.",
      });
    }
  } catch (
