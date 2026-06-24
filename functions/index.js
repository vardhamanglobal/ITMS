const functions = require("firebase-functions");
const admin    = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp({
  databaseURL: "https://corpdesk-f49b1-default-rtdb.asia-southeast1.firebasedatabase.app",
});
const db = admin.database();

// Set these via: firebase functions:config:set mail.user="..." mail.pass="..." mail.to="..."
function cfg(key, fallback = "") {
  try { return functions.config().mail[key]; } catch { return fallback; }
}

function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER || cfg("user"),
      pass: process.env.GMAIL_PASS || cfg("pass"),
    },
  });
}

const RECIPIENT = () => process.env.REMINDER_TO || cfg("to");
const CRON_SECRET = () => process.env.CRON_SECRET || cfg("secret", "");

// Helpers
const toArr = snap => {
  const v = snap.val();
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : Object.values(v).filter(Boolean);
};

const daysDiff = (dateStr, today) =>
  Math.round((new Date(dateStr).setHours(0,0,0,0) - today) / 86400000);

const fmtDate = d =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const dueLabel = d =>
  d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days`;

const urgencyColor = (d, threshold1 = 1, threshold2 = 3) =>
  d <= threshold1 ? "#dc2626" : d <= threshold2 ? "#d97706" : "#059669";

function buildEmailHtml(simsDue, appsDue, warrantyDue, today) {
  const dateLabel = new Date(today).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  let html = `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1e293b">
  <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 28px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;color:#fff;font-size:20px">ITMS · Daily Reminders</h2>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">${dateLabel}</p>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">`;

  const tableStyle = `width:100%;border-collapse:collapse;margin-top:12px;font-size:13px`;
  const thStyle = `background:#f8fafc;padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#64748b`;
  const tdStyle = `padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:middle`;

  if (simsDue.length) {
    html += `<h3 style="margin:0 0 4px;font-size:14px;color:#7c3aed">SIM Plans Due (${simsDue.length})</h3>
    <table style="${tableStyle}">
      <tr>
        <th style="${thStyle}">Employee</th>
        <th style="${thStyle}">Carrier / Plan</th>
        <th style="${thStyle}" align="right">Amount</th>
        <th style="${thStyle}">Due Date</th>
      </tr>`;
    simsDue.forEach(s => {
      const d = daysDiff(s.nextBillingDate, today);
      html += `<tr>
        <td style="${tdStyle}">${s.employee || "—"}</td>
        <td style="${tdStyle}">${s.carrier} &middot; ${s.planName}</td>
        <td style="${tdStyle};text-align:right;font-family:monospace">${s.currency} ${s.amount}</td>
        <td style="${tdStyle}">
          <span style="color:${urgencyColor(d)};font-weight:600">${fmtDate(s.nextBillingDate)}</span>
          <span style="font-size:11px;color:#94a3b8;margin-left:6px">${dueLabel(d)}</span>
        </td>
      </tr>`;
    });
    html += `</table>`;
  }

  if (appsDue.length) {
    html += `<h3 style="margin:${simsDue.length ? "24px" : "0"} 0 4px;font-size:14px;color:#7c3aed">App Subscriptions Due (${appsDue.length})</h3>
    <table style="${tableStyle}">
      <tr>
        <th style="${thStyle}">App</th>
        <th style="${thStyle}">Plan</th>
        <th style="${thStyle}" align="right">Amount / seat</th>
        <th style="${thStyle}">Due Date</th>
      </tr>`;
    appsDue.forEach(a => {
      const d = daysDiff(a.nextBillingDate, today);
      html += `<tr>
        <td style="${tdStyle};font-weight:600">${a.appName}</td>
        <td style="${tdStyle};color:#64748b">${a.planTier} &middot; ${a.billingCycle || "monthly"}</td>
        <td style="${tdStyle};text-align:right;font-family:monospace">${a.currency} ${a.amount}</td>
        <td style="${tdStyle}">
          <span style="color:${urgencyColor(d)};font-weight:600">${fmtDate(a.nextBillingDate)}</span>
          <span style="font-size:11px;color:#94a3b8;margin-left:6px">${dueLabel(d)}</span>
        </td>
      </tr>`;
    });
    html += `</table>`;
  }

  if (warrantyDue.length) {
    html += `<h3 style="margin:${(simsDue.length || appsDue.length) ? "24px" : "0"} 0 4px;font-size:14px;color:#7c3aed">Warranties Expiring Soon (${warrantyDue.length})</h3>
    <table style="${tableStyle}">
      <tr>
        <th style="${thStyle}">Asset</th>
        <th style="${thStyle}">Type</th>
        <th style="${thStyle}">Assigned To</th>
        <th style="${thStyle}">Expires</th>
      </tr>`;
    warrantyDue.forEach(a => {
      const d = daysDiff(a.warrantyDate, today);
      html += `<tr>
        <td style="${tdStyle};font-weight:600">${a.name}</td>
        <td style="${tdStyle};color:#64748b">${a.type}</td>
        <td style="${tdStyle}">${a.assignedTo || "Pool"}</td>
        <td style="${tdStyle}">
          <span style="color:${urgencyColor(d, 7, 14)};font-weight:600">${fmtDate(a.warrantyDate)}</span>
          <span style="font-size:11px;color:#94a3b8;margin-left:6px">${dueLabel(d)}</span>
        </td>
      </tr>`;
    });
    html += `</table>`;
  }

  html += `
    <p style="margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
      Sent automatically by ITMS · Vardhamanglobal · <a href="#" style="color:#7c3aed">Open ITMS</a>
    </p>
  </div>
</div>`;

  return html;
}

// HTTP Cloud Function — call via POST/GET with correct secret header
exports.sendReminders = functions.https.onRequest(async (req, res) => {
  // Simple secret check to prevent unauthorized triggers
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  const expected = CRON_SECRET();
  if (expected && secret !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const within = (dateStr, days) => {
    if (!dateStr) return false;
    const d = daysDiff(dateStr, todayMs);
    return d >= 0 && d <= days;
  };

  try {
    const [simsSnap, appsSnap, assetsSnap] = await Promise.all([
      db.ref("/vgi/sims").once("value"),
      db.ref("/vgi/apps").once("value"),
      db.ref("/vgi/assets").once("value"),
    ]);

    const sims   = toArr(simsSnap);
    const apps   = toArr(appsSnap);
    const assets = toArr(assetsSnap);

    const simsDue     = sims.filter(s => s.payment !== "paid" && within(s.nextBillingDate, 7));
    const appsDue     = apps.filter(a => a.payment !== "paid" && a.payMode !== "autopay" && within(a.nextBillingDate, 7));
    const warrantyDue = assets.filter(a => within(a.warrantyDate, 30));

    if (!simsDue.length && !appsDue.length && !warrantyDue.length) {
      return res.json({ sent: false, message: "Nothing due in the next 7 days." });
    }

    const subject = [
      simsDue.length   && `${simsDue.length} SIM payment${simsDue.length > 1 ? "s" : ""}`,
      appsDue.length   && `${appsDue.length} app subscription${appsDue.length > 1 ? "s" : ""}`,
      warrantyDue.length && `${warrantyDue.length} warranty expiry`,
    ].filter(Boolean).join(", ");

    await getTransporter().sendMail({
      from:    `"ITMS Reminders" <${process.env.GMAIL_USER || cfg("user")}>`,
      to:      RECIPIENT(),
      subject: `ITMS: ${subject}`,
      html:    buildEmailHtml(simsDue, appsDue, warrantyDue, todayMs),
    });

    console.log(`Reminder sent — sims:${simsDue.length} apps:${appsDue.length} warranties:${warrantyDue.length}`);
    return res.json({ sent: true, sims: simsDue.length, apps: appsDue.length, warranties: warrantyDue.length });

  } catch (err) {
    console.error("sendReminders error:", err);
    return res.status(500).json({ error: err.message });
  }
});
