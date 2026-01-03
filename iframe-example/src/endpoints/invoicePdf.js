const PDFDocument = require("pdfkit");

// --- helpers ---
function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  const json = Buffer.from(payload, "base64").toString("utf8");
  return JSON.parse(json);
}

function monthRangeUTC(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString();
  return { start, end };
}

function secondsToHours(seconds) {
  return Math.round((Number(seconds || 0) / 3600) * 100) / 100;
}

function centsToMoney(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function pickTotalsFromSummaryResponse(data) {
  // We’ve seen two shapes:
  // A) data.groupOne[0] contains totals (duration/amount)
  // B) data.totals[0] contains totals (totalBillableTime/totalAmountByCurrency)
  if (Array.isArray(data?.groupOne) && data.groupOne.length) return data.groupOne[0];
  if (Array.isArray(data?.totals) && data.totals.length) return data.totals[0];
  if (data?.totals && typeof data.totals === "object") return data.totals;
  if (data?.total && typeof data.total === "object") return data.total;
  return null;
}

async function fetchApprovedBillableSummary({ reportsUrl, workspaceId, userId, token, ym }) {
  const { start, end } = monthRangeUTC(ym);

  const url = `${reportsUrl.replace(/\/$/, "")}/v1/workspaces/${workspaceId}/reports/summary`;

  const body = {
    dateRangeStart: start,
    dateRangeEnd: end,
    users: { ids: [userId] },
    billable: true,
    approvalState: "APPROVED",
    summaryFilter: { groups: ["USER"] },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Addon-Token": token,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Reports API failed ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const totals = pickTotalsFromSummaryResponse(data);
  if (!totals) return { hours: 0, currency: null, amount: null, raw: data };

  // Time can be in duration (seconds) or totalBillableTime (seconds)
  const seconds =
    totals.totalBillableTime ??
    totals.billableTime ??
    totals.totalTime ??
    totals.duration ??
    0;

  // Money can be in totalAmountByCurrency or amounts[0].amountByCurrency or amount
  let currency = null;
  let amountCents = null;

  if (Array.isArray(totals.totalAmountByCurrency) && totals.totalAmountByCurrency.length) {
    currency = totals.totalAmountByCurrency[0]?.currency ?? null;
    amountCents = totals.totalAmountByCurrency[0]?.amount ?? null;
  }

  if ((currency == null || amountCents == null) && Array.isArray(totals.amounts) && totals.amounts.length) {
    const byCur = totals.amounts[0]?.amountByCurrency;
    if (Array.isArray(byCur) && byCur.length) {
      currency = byCur[0]?.currency ?? currency;
      amountCents = byCur[0]?.amount ?? amountCents;
    }
  }

  if (amountCents == null && totals.amount != null) {
    amountCents = totals.amount;
  }

  return {
    hours: secondsToHours(seconds),
    currency,
    amountCents,
    rawTotals: totals,
  };
}

// --- endpoint registration ---
module.exports.registerInvoicePdfEndpoint = function registerInvoicePdfEndpoint(app) {
  app.get("/invoice.pdf", async (req, res) => {
    try {
      const ym = req.query.month; // "YYYY-MM"
      if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
        return res.status(400).send("Missing or invalid month. Use ?month=YYYY-MM");
      }

      // Prefer header. Allow query for debugging if needed.
      const token = req.header("X-Addon-Token") || req.query.auth_token;
      if (!token) return res.status(401).send("Missing X-Addon-Token");

      const jwt = decodeJwtPayload(token);
      const workspaceId = jwt.workspaceId;
      const userId = jwt.user || req.query.userId;
      const reportsUrl = jwt.reportsUrl;

      if (!workspaceId || !userId || !reportsUrl) {
        return res.status(400).send("Token missing workspaceId/user/reportsUrl");
      }

      const summary = await fetchApprovedBillableSummary({ reportsUrl, workspaceId, userId, token, ym });

      // If nothing approved/billable, return a friendly PDF anyway
      const currency = summary.currency || "USD";
      const amountStr = summary.amountCents != null ? centsToMoney(summary.amountCents) : "0.00";

      // ---- build PDF ----
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="invoice-${ym}-${userId}.pdf"`
      );

      const doc = new PDFDocument({ size: "A4", margin: 50 });
      doc.pipe(res);

      // Header
      doc.fontSize(20).text("INVOICE", { align: "right" });
      doc.moveDown(0.5);

      // SpainLink (Bill To) - hardcoded for MVP
      doc.fontSize(10).text("Bill To:");
      doc.fontSize(12).text("SPAINLINK DEVELOPMENT SOLUTIONS S.L.");
      doc.fontSize(10).text("VAT/CIF: B55470280");
      doc.text("Address: Avenida Luis Celso Garcia Guadalupe 3 Bloque 2 Portal A Bajo A, 38111, Santa Cruz de Tenerife, España.");
      doc.text("Email: spainlink@spainlink.es");
      doc.moveDown();

      // Vendor (Bill From) - MVP from Clockify user name
      doc.fontSize(10).text("Bill From:");
      doc.fontSize(12).text(jwt.name || "Contractor");
      doc.fontSize(10).text("Tax ID: [ADD]");
      doc.text("Address: [ADD]");
      doc.text("Email: [ADD]");
      doc.moveDown();

      // Invoice meta
      const today = new Date().toISOString().slice(0, 10);
      doc.fontSize(10).text(`Invoice Date: ${today}`);
      doc.text(`Invoice Period: ${ym}`);
      doc.text(`Workspace: ${workspaceId}`);
      doc.moveDown();

      // Line item
      doc.fontSize(12).text("Line items", { underline: true });
      doc.moveDown(0.5);

      doc.fontSize(10).text(`Approved billable time for ${ym}`);
      doc.text(`Hours: ${summary.hours}`);
      doc.text(`Amount: ${currency} ${amountStr}`);
      doc.moveDown();

      // Total
      doc.fontSize(14).text(`TOTAL: ${currency} ${amountStr}`, { align: "right" });

      doc.end();
    } catch (e) {
      console.error(e);
      res.status(500).send(String(e));
    }
  });
};