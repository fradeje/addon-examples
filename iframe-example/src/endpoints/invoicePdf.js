const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// ----------------- helpers -----------------
function decodeJwtPayload(token) {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json);
}

function monthRangeUTC(ym) {
    const [y, m] = ym.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)).toISOString();
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString(); // last day
    return { start, end };
}

function monthLabel(ym) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function secondsToHours(seconds) {
    return Math.round((Number(seconds || 0) / 3600) * 100) / 100;
}

function centsToMoney(cents) {
    return (Number(cents || 0) / 100).toFixed(2);
}

function moneyCentsFrom(hours, rate) {
    return Math.round(Number(hours || 0) * Number(rate || 0) * 100);
}

function pickTotalsFromSummaryResponse(data) {
    if (Array.isArray(data?.groupOne) && data.groupOne.length) return data.groupOne[0];
    if (Array.isArray(data?.totals) && data.totals.length) return data.totals[0];
    if (data?.totals && typeof data.totals === "object") return data.totals;
    if (data?.total && typeof data.total === "object") return data.total;
    return null;
}

// ----------------- Reports API -----------------
async function fetchApprovedBillableByProject({ reportsUrl, workspaceId, userId, token, ym }) {
    const { start, end } = monthRangeUTC(ym);
    const url = `${reportsUrl.replace(/\/$/, "")}/v1/workspaces/${workspaceId}/reports/summary`;

    const body = {
        dateRangeStart: start,
        dateRangeEnd: end,
        users: { ids: [userId] },
        billable: true,
        approvalState: "APPROVED",
        summaryFilter: { groups: ["PROJECT"] }, // ✅ key change
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Addon-Token": token },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Reports API failed ${res.status}: ${txt}`);
    }

    const data = await res.json();

    const groups =
        (Array.isArray(data?.groupOne) && data.groupOne) ||
        (Array.isArray(data?.groupTwo) && data.groupTwo) ||
        [];

    // Normalize each row into { name, seconds }
    const rows = groups
        .map((g) => {
            const seconds =
                g.totalBillableTime ??
                g.billableTime ??
                g.totalTime ??
                g.duration ??
                0;

            const name =
                g.name ??
                g.projectName ??
                g.project?.name ??
                "Unknown project";

            return { name: String(name), seconds: Number(seconds || 0) };
        })
        .filter((r) => Number.isFinite(r.seconds) && r.seconds > 0);

    // Fallback: if API returns no groups, try totals as a single “All projects” row
    if (!rows.length) {
        const totals = pickTotalsFromSummaryResponse(data);
        const seconds =
            totals?.totalBillableTime ??
            totals?.billableTime ??
            totals?.totalTime ??
            totals?.duration ??
            0;

        return {
            rows: [
                { name: "Professional services", seconds: Number(seconds || 0) }
            ],
            raw: data,
        };
    }

    return { rows, raw: data };
}

// ----------------- ECB FX (USD -> EUR) -----------------
async function fetchEcbUsdToEur() {
    // ECB daily reference rates: base = EUR, includes USD as USD per 1 EUR.
    // We need EUR per 1 USD = 1 / (USD per EUR).
    const url = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

    const res = await fetch(url);
    if (!res.ok) throw new Error(`ECB FX fetch failed ${res.status}: ${await res.text()}`);

    const xml = await res.text();

    const timeMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
    const fxDate = timeMatch ? timeMatch[1] : null;

    const usdMatch = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/);
    if (!usdMatch) throw new Error("ECB FX parse failed: USD rate not found");

    const usdPerEur = Number(usdMatch[1]);
    if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) throw new Error("ECB FX parse failed: invalid USD rate");

    const eurPerUsd = 1 / usdPerEur;
    return { eurPerUsd, fxDate };
}

// ---------- vendor profile store (file-based) ----------
function profilesDir() {
    return path.join(process.cwd(), "data", "vendorProfiles");
}

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function profilePath(userId) {
    ensureDir(profilesDir());
    return path.join(profilesDir(), `${userId}.json`);
}

function readProfile(userId) {
    const fp = profilePath(userId);
    if (!fs.existsSync(fp)) return {};
    return JSON.parse(fs.readFileSync(fp, "utf8"));
}

function writeProfile(userId, profile) {
    const fp = profilePath(userId);
    fs.writeFileSync(fp, JSON.stringify(profile, null, 2), "utf8");
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

// ---------- PDF layout helpers ----------
function drawHr(doc, x, y, w) {
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor("#e6e6e6").lineWidth(1).stroke();
}

function drawTableHeader(doc, x, y, cols, rowH) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111");
    cols.forEach((c) => {
        doc.text(c.label, c.x, y + 6, { width: c.w, align: c.align || "left" });
    });
    doc.font("Helvetica");
    drawHr(doc, x, y + rowH, cols.reduce((s, c) => s + c.w, 0));
}

function drawTableRow(doc, y, cols, row, rowH) {
    doc.fontSize(10).fillColor("#111");
    cols.forEach((c) => {
        const text = row[c.key] ?? "";
        doc.text(String(text), c.x, y + 6, { width: c.w, align: c.align || "left" });
    });
    drawHr(doc, cols[0].x, y + rowH, cols.reduce((s, c) => s + c.w, 0));
}

function drawWrappedLines(doc, x, y, width, lines, lineGap = 2) {
    lines.forEach((t) => {
        doc.text(t, x, y, { width });
        const h = doc.heightOfString(t, { width });
        y += h + lineGap;
    });
    return y;
}

function drawTextBox(doc, left, pageW, y, title, text) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text(title, left, y);
    y += 10;

    const boxPadding = 10;
    const boxWidth = pageW;
    const textWidth = boxWidth - boxPadding * 2;

    doc.font("Helvetica").fontSize(10).fillColor("#111");

    const textHeight = doc.heightOfString(text, { width: textWidth });
    const boxHeight = Math.max(60, textHeight + boxPadding * 2);

    const bottomLimit = doc.page.height - doc.page.margins.bottom - 80;
    if (y + boxHeight > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
    }

    doc.roundedRect(left, y, boxWidth, boxHeight, 6).strokeColor("#e6e6e6").lineWidth(1).stroke();
    doc.text(text, left + boxPadding, y + boxPadding, { width: textWidth });

    y += boxHeight;
    return y;
}

function ensureTableSpace(doc, y, neededH, left, pageW, cols, rowH) {
    const bottomLimit = doc.page.height - doc.page.margins.bottom - 120;
    if (y + neededH <= bottomLimit) return y;

    doc.addPage();
    y = doc.page.margins.top;

    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text("Line items (cont.)", left, y);
    y += 10;
    drawHr(doc, left, y + 6, pageW);
    y += 14;

    drawTableHeader(doc, left, y, cols, rowH);
    y += rowH;

    return y;
}

// ----------------- endpoint -----------------
module.exports.registerInvoicePdfEndpoint = function registerInvoicePdfEndpoint(app) {
    app.get("/invoice.pdf", async (req, res) => {
        let userId = null;
        let usedCounter = null;
        let doc = null; // ✅ keep reference so we can safely stop it on error

        try {
            const ym = req.query.month; // "YYYY-MM"
            if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
                return res.status(400).send("Missing or invalid month. Use ?month=YYYY-MM");
            }

            const token = req.header("X-Addon-Token") || req.query.auth_token;
            if (!token) return res.status(401).send("Missing X-Addon-Token");

            const jwt = decodeJwtPayload(token);
            const workspaceId = jwt.workspaceId;
            userId = jwt.user || req.query.userId;
            const reportsUrl = jwt.reportsUrl;

            if (!workspaceId || !userId || !reportsUrl) {
                return res.status(400).send("Token missing workspaceId/user/reportsUrl");
            }

            // Load vendor profile
            const profile = readProfile(userId);

            const prefix = (profile.invoicePrefix || "INV").trim() || "INV";

            // canonical counter field (with legacy fallback)
            let nextCounter =
                profile.nextInvoiceCounter ??
                profile.nextInvoiceNumber ?? // legacy
                1;

            nextCounter = Number(nextCounter);
            if (!Number.isFinite(nextCounter) || nextCounter < 1) nextCounter = 1;

            usedCounter = nextCounter;
            const invoiceNumber = `${prefix}-${nextCounter}`;

            // ✅ DEFAULTS (fixes vatPercent not defined + makes missing => 0)
            const irpfPercent = Number(profile.irpfPercent || 0) || 0;
            const vatPercent = Number(profile.vatPercent || 0) || 0;

            // Stored base rate (normally USD, but can be “already EUR” when checkbox is set)
            const baseRate = Number(profile.rate || 0);
            const selectedCurrency = String(profile.currency || "USD").toUpperCase();
            const baseRateIsEur = !!profile.baseRateIsEur;

            // Decide invoice currency + effective rate
            let currency = "USD";
            let rateToUse = baseRate;
            let conversionComment = null;

            if (selectedCurrency === "EUR") {
                currency = "EUR";

                if (baseRateIsEur) {
                    // ✅ No FX conversion, and no conversion comment
                    rateToUse = baseRate;
                    conversionComment = null;
                } else {
                    // ✅ FX conversion USD -> EUR (ECB)
                    const { eurPerUsd, fxDate } = await fetchEcbUsdToEur();
                    rateToUse = baseRate * eurPerUsd;

                    const fxStr = eurPerUsd.toFixed(6);
                    const eurRateStr = rateToUse.toFixed(2);
                    conversionComment = `USD ${baseRate.toFixed(2)} × ${fxStr} = EUR ${eurRateStr}${fxDate ? ` (ECB ${fxDate})` : ""}`;
                }
            }

            // ✅ safety clamp
            if (!Number.isFinite(rateToUse) || rateToUse < 0) rateToUse = 0;

            // Fetch approved+billable PROJECT rows (do this BEFORE piping PDF)
            const report = await fetchApprovedBillableByProject({ reportsUrl, workspaceId, userId, token, ym });

            // ---- PDF headers ----
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoiceNumber}.pdf"`);

            doc = new PDFDocument({ size: "A4", margin: 50 });
            doc.pipe(res);

            // if client closes early, stop PDF
            res.on("close", () => {
                try { doc?.end(); } catch { }
            });

            const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const left = doc.page.margins.left;

            // Header
            doc.font("Helvetica-Bold").fontSize(22).text("INVOICE", left, 40, { width: pageW, align: "right" });
            doc.font("Helvetica-Bold").fontSize(14).text(`Invoice # ${invoiceNumber}`, left, 66, { width: pageW, align: "right" });

            // Dates / period
            const today = todayISO();
            const periodLabel = monthLabel(ym);

            doc.font("Helvetica").fontSize(10).fillColor("#111");
            doc.text(`Invoice date: ${today}`, left, 95);
            doc.text(`Issue date: ${today}`, left, 110);
            doc.text(`Invoice period: ${periodLabel}`, left, 125);

            // Bill From / Bill To blocks
            const yBlocks = 155;
            const colGap = 24;
            const half = (pageW - colGap) / 2;

            // Bill From
            doc.font("Helvetica-Bold").fontSize(11).text("Bill From", left, yBlocks);
            doc.font("Helvetica").fontSize(10);

            const fromLines = [
                profile.name || "Contractor",
                profile.taxId ? `Tax ID: ${profile.taxId}` : null,
                profile.address || null,
                profile.email || null,
            ].filter(Boolean);

            let yFrom = yBlocks + 16;
            yFrom = drawWrappedLines(doc, left, yFrom, half, fromLines);

            // Bill To
            const xTo = left + half + colGap;
            doc.font("Helvetica-Bold").fontSize(11).text("Bill To", xTo, yBlocks);
            doc.font("Helvetica").fontSize(10);

            const toLines = [
                "SPAINLINK DEVELOPMENT SOLUTIONS S.L.",
                "VAT/CIF: B55470280",
                "Avenida Luis Celso Garcia Guadalupe 3 Bloque 2 Portal A Bajo A, 38111, Santa Cruz de Tenerife, España.",
                "spainlink@spainlink.es",
            ];

            let yTo = yBlocks + 16;
            yTo = drawWrappedLines(doc, xTo, yTo, half, toLines);

            // Line items
            let y = Math.max(yFrom, yTo) + 18;
            doc.font("Helvetica-Bold").fontSize(12).text("Line items", left, y);
            y += 10;
            drawHr(doc, left, y + 6, pageW);
            y += 14;

            // Table
            const cols = (() => {
                const wDesc = Math.round(pageW * 0.55);
                const wHours = Math.round(pageW * 0.15);
                const wRate = Math.round(pageW * 0.15);
                const wAmt = pageW - wDesc - wHours - wRate;

                return [
                    { key: "desc", label: "Project", x: left, w: wDesc, align: "left" },
                    { key: "hours", label: "Hours", x: left + wDesc, w: wHours, align: "right" },
                    { key: "rate", label: "Rate", x: left + wDesc + wHours, w: wRate, align: "right" },
                    { key: "amount", label: "Amount", x: left + wDesc + wHours + wRate, w: wAmt, align: "right" },
                ];
            })();

            const rowH = 26;
            drawTableHeader(doc, left, y, cols, rowH);
            y += rowH;

            // Build rows
            let subtotalCents = 0;

            for (const r of report.rows) {
                const projectHours = secondsToHours(r.seconds);

                // page break if needed (and re-draw table header)
                y = ensureTableSpace(doc, y, rowH + 6, left, pageW, cols, rowH);

                const lineCents = moneyCentsFrom(projectHours, rateToUse);
                subtotalCents += lineCents;

                const row = {
                    desc: r.name,
                    hours: projectHours.toFixed(2),
                    rate: `${currency} ${Number(rateToUse || 0).toFixed(2)}`,
                    amount: `${currency} ${centsToMoney(lineCents)}`,
                };

                drawTableRow(doc, y, cols, row, rowH);
                y += rowH;
            }

            y += 14;

            // Totals (✅ uses declared vatPercent/irpfPercent)
            const vatCents = vatPercent > 0 ? Math.round(subtotalCents * (vatPercent / 100)) : 0;
            const irpfCents = irpfPercent > 0 ? Math.round(subtotalCents * (irpfPercent / 100)) : 0;
            const totalDueCents = subtotalCents + vatCents - irpfCents;

            // If totals are too close to bottom, push to new page
            {
                const bottomLimit = doc.page.height - doc.page.margins.bottom - 140;
                const est = 18 * (2 + (vatPercent > 0 ? 1 : 0) + (irpfPercent > 0 ? 1 : 0));
                if (y + est > bottomLimit) {
                    doc.addPage();
                    y = doc.page.margins.top;
                }
            }

            const totalsX = left + Math.round(pageW * 0.55);
            const totalsW = pageW - (totalsX - left);

            doc.font("Helvetica").fontSize(10).fillColor("#111");
            doc.text("Subtotal", totalsX, y, { width: totalsW * 0.5, align: "left" });
            doc.text(`${currency} ${centsToMoney(subtotalCents)}`, totalsX, y, { width: totalsW, align: "right" });
            y += 16;

            if (vatPercent > 0) {
                doc.text(`IGIC/IVA (${vatPercent.toFixed(2)}%)`, totalsX, y, { width: totalsW * 0.5, align: "left" });
                doc.text(`+ ${currency} ${centsToMoney(vatCents)}`, totalsX, y, { width: totalsW, align: "right" });
                y += 16;
            }

            if (irpfPercent > 0) {
                doc.text(`IRPF (${irpfPercent.toFixed(2)}%)`, totalsX, y, { width: totalsW * 0.5, align: "left" });
                doc.text(`- ${currency} ${centsToMoney(irpfCents)}`, totalsX, y, { width: totalsW, align: "right" });
                y += 16;
            }

            doc.font("Helvetica-Bold").fontSize(12);
            doc.text("Total due", totalsX, y, { width: totalsW * 0.5, align: "left" });
            doc.text(`${currency} ${centsToMoney(totalDueCents)}`, totalsX, y, { width: totalsW, align: "right" });
            y += 8;

            // Comments (conversion info) — only when we actually converted
            if (conversionComment) {
                y += 18;
                y = drawTextBox(doc, left, pageW, y, "Comments", conversionComment);
            }

            // Payment details
            const paymentDetails = String(profile.paymentDetails || "").trim();
            if (paymentDetails) {
                y += 18;
                y = drawTextBox(doc, left, pageW, y, "Payment details", paymentDetails);
            }

            // Notes
            const notes = String(profile.notes || "").trim();
            if (notes) {
                y += 18;
                y = drawTextBox(doc, left, pageW, y, "Notes", notes);
            }

            // Footer
            doc.font("Helvetica").fontSize(9).fillColor("#444");
            doc.text(
                "Generated from approved + billable Clockify time. Please keep this invoice for your records.",
                left,
                doc.page.height - 70,
                { width: pageW }
            );

            // Only bump the counter AFTER the PDF stream is successfully finished.
            res.on("finish", () => {
                try {
                    const p = readProfile(userId);

                    let currentCounter = Number(p.nextInvoiceCounter ?? p.nextInvoiceNumber ?? 1);
                    if (!Number.isFinite(currentCounter) || currentCounter < 1) currentCounter = 1;

                    if (usedCounter != null && currentCounter === usedCounter) {
                        p.nextInvoiceCounter = currentCounter + 1;
                        delete p.nextInvoiceNumber; // legacy cleanup
                        writeProfile(userId, p);
                    }
                } catch (err) {
                    console.error("Failed to bump invoice counter:", err);
                }
            });

            doc.end();
        } catch (e) {
            console.error(e);

            // ✅ stop PDF stream if it started
            try { doc?.end(); } catch { }

            // ✅ avoid "write after end"
            if (res.headersSent) {
                try { res.end(); } catch { }
                return;
            }

            res.status(500).send(String(e));
        }
    });
};