#!/usr/bin/env node
/**
 * Standalone reminder script — run via GitHub Actions (free) or any Node.js cron.
 * Reads Firebase RTDB, sends email via Gmail App Password.
 *
 * Required env vars:
 *   FIREBASE_SERVICE_ACCOUNT  — full JSON string of Firebase service account key
 *   GMAIL_USER                — Gmail address used as sender
 *   GMAIL_PASS                — Gmail App Password (16-char, no spaces)
 *   REMINDER_TO               — recipient email (comma-separated for multiple)
 */

const admin    = require("firebase-admin");
const nodemailer = require("nodemailer");

// ── Init ─────────────────────────────────────────────────────────────────────

const DB_URL = "https://corpdesk-f49b1-default-rtdb.asia-southeast1.firebasedatabase.app";

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT env var");
  process.exit(1);
}
if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
  console.error("Missing GMAIL_USER or GMAIL_PASS env var");
  process.exit(1);
}
if (!process.env.REMINDER_TO) {
  console.error("Missing REMINDER_TO env var");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: DB_URL,
});
const db = admin.database();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const toArr = val => {
  if (!val) return [];
  return Array.isArray(val) ? val.filter(Boolean) : Object.values(val).filter(Boolean);
};

const todayMs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();

const daysDiff = dateStr =>
  Math.round((new Date(dateStr).setHours(0,0,0,0) - todayMs) / 86400000);

const within = (dateStr, days) => {
  if (!dateStr) return false;
  const d = daysDiff(dateStr);
  return d >= 0 && d <= days;
};

const fmtDate = dateStr =>
  new Date(dateStr).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });

const dueLabel = d => d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days`;

const urgencyColor = (d, t1 = 1, t2 = 3) =>
  d <= t1 ? "#dc2626" : d <= t2 ? "#d97706" : "#059669";

// ── Email builder ─────────────────────────────────────────────────────────────

function buildHtml(simsDue, appsDue, warrantyDue) {
  const dateLabel = new Date(todayMs).toLocaleDateString("en-IN", {
    weekday:"long", day:"2-digit", month:"long", year:"numeric",
  });

  const tableStyle = "width:100%;border-collapse:collapse;margin-top:10px;font-size:13px";
  const thStyle    = "background:#f8fafc;padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#64748b";
  const tdStyle    = "padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:middle";

  let html = `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1e293b">
  <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 28px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;color:#fff;font-size:20px">ITMS · Daily Reminders</h2>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.75);font-size:13px">${dateLabel}</p>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">`;

  if (simsDue.length) {
    html += `<h3 style="margin:0 0 4px;font-size:14px;color:#7c3aed">SIM Plans Due (${simsDue.length})</h3>
    <table style="${tableStyle}">
      <tr><th style="${thStyle}">Employee</th><th style="${thStyle}">Carrier / Plan</th><th style="${thStyle}" align="right">Amount</th><th style="${thStyle}">Due Date</th></tr>`;
    simsDue.forEach(s => {
      const d = daysDiff(s.nextBillingDate);
      html += `<tr>
        <td style="${tdStyle}">${s.employee || "—"}</td>
        <td style="${tdStyle}">${s.carrier} · ${s.planName}</td>
        <td style="${tdStyle};text-align:right;font-family:monospace">${s.currency} ${s.amount}</td>
        <td style="${tdStyle}"><span style="color:${urgencyColor(d)};font-weight:600">${fmtDate(s.nextBillingDate)}</span> <span style="font-size:11px;color:#94a3b8">${dueLabel(d)}</span></td>
      </tr>`;
    });
    html += `</table>`;
  }

  if (appsDue.length) {
    html += `<h3 style="margin:${simsDue.length ? "22px" : "0"} 0 4px;font-size:14px;color:#7c3aed">App Subscriptions Due (${appsDue.length})</h3>
    <table style="${tableStyle}">
      <tr><th style="${thStyle}">App</th><th style="${thStyle}">Plan</th><th style="${thStyle}" align="right">Amount/seat</th><th style="${thStyle}">Due Date</th></tr>`;
    appsDue.forEach(a => {
      const d = daysDiff(a.nextBillingDate);
      html += `<tr>
        <td style="${tdStyle};font-weight:600">${a.appName}</td>
        <td style="${tdStyle};color:#64748b">${a.planTier} · ${a.billingCycle || "monthly"}</td>
        <td style="${tdStyle};text-align:right;font-family:monospace">${a.currency} ${a.amount}</td>
        <td style="${tdStyle}"><span style="color:${urgencyColor(d)};font-weight:600">${fmtDate(a.nextBillingDate)}</span> <span style="font-size:11px;color:#94a3b8">${dueLabel(d)}</span></td>
      </tr>`;
    });
    html += `</table>`;
  }

  if (warrantyDue.length) {
    html += `<h3 style="margin:${(simsDue.length||appsDue.length) ? "22px" : "0"} 0 4px;font-size:14px;color:#7c3aed">Warranties Expiring Soon (${warrantyDue.length})</h3>
    <table style="${tableStyle}">
      <tr><th style="${thStyle}">Asset</th><th style="${thStyle}">Type</th><th style="${thStyle}">Assigned To</th><th style="${thStyle}">Expires</th></tr>`;
    warrantyDue.forEach(a => {
      const d = daysDiff(a.warrantyDate);
      html += `<tr>
        <td style="${tdStyle};font-weight:600">${a.name}</td>
        <td style="${tdStyle};color:#64748b">${a.type}</td>
        <td style="${tdStyle}">${a.assignedTo || "Pool"}</td>
        <td style="${tdStyle}"><span style="color:${urgencyColor(d,7,14)};font-weight:600">${fmtDate(a.warrantyDate)}</span> <span style="font-size:11px;color:#94a3b8">${dueLabel(d)}</span></td>
      </tr>`;
    });
    html += `</table>`;
  }

  html += `
    <p style="margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
      Sent automatically by ITMS · Vardhamanglobal
    </p>
  </div>
</div>`;

  return html;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching data from Firebase…");

  const [simsSnap, appsSnap, assetsSnap] = await Promise.all([
    db.ref("/vgi/sims").once("value"),
    db.ref("/vgi/apps").once("value"),
    db.ref("/vgi/assets").once("value"),
  ]);

  const sims   = toArr(simsSnap.val());
  const apps   = toArr(appsSnap.val());
  const assets = toArr(assetsSnap.val());

  const simsDue     = sims.filter(s => s.payment !== "paid" && within(s.nextBillingDate, 7));
  const appsDue     = apps.filter(a => a.payment !== "paid" && a.payMode !== "autopay" && within(a.nextBillingDate, 7));
  const warrantyDue = assets.filter(a => within(a.warrantyDate, 30));

  console.log(`Found: ${simsDue.length} SIMs, ${appsDue.length} apps, ${warrantyDue.length} warranties`);

  if (!simsDue.length && !appsDue.length && !warrantyDue.length) {
    console.log("Nothing due — no email sent.");
    process.exit(0);
  }

  const parts = [
    simsDue.length   && `${simsDue.length} SIM payment${simsDue.length > 1 ? "s" : ""}`,
    appsDue.length   && `${appsDue.length} app subscription${appsDue.length > 1 ? "s" : ""}`,
    warrantyDue.length && `${warrantyDue.length} warranty expiry`,
  ].filter(Boolean).join(", ");

  await transporter.sendMail({
    from:    `"ITMS Reminders" <${process.env.GMAIL_USER}>`,
    to:      process.env.REMINDER_TO,
    subject: `ITMS: ${parts}`,
    html:    buildHtml(simsDue, appsDue, warrantyDue),
  });

  console.log(`Email sent to ${process.env.REMINDER_TO}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
