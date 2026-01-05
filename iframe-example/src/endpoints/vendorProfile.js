const fs = require("fs");
const path = require("path");

function decodeJwtPayload(token) {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json);
}

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function toNumOrEmpty(v) {
    if (v === "" || v == null) return "";
    const n = Number(v);
    return Number.isFinite(n) ? n : "";
}

function toIntOrNull(v) {
    if (v === "" || v == null) return null;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
}

function sanitizeLogoDataUrl(v) {
    if (v == null || v === "") return "";
    if (typeof v !== "string") return "";

    // allow only data:image/png or data:image/jpeg
    if (!v.startsWith("data:image/")) return "";
    if (!(v.startsWith("data:image/png;base64,") || v.startsWith("data:image/jpeg;base64,"))) return "";

    // basic size guard: approx decoded bytes = base64Len * 3/4
    const comma = v.indexOf(",");
    if (comma < 0) return "";
    const b64 = v.slice(comma + 1);
    const approxBytes = Math.floor((b64.length * 3) / 4);

    // ~300KB max (keep consistent with sidebar.js)
    const MAX = 300 * 1024;
    if (approxBytes > MAX) return "";

    return v;
}

module.exports.registerVendorProfileEndpoint = function registerVendorProfileEndpoint(app) {
    const storeDir = path.join(process.cwd(), "data", "vendorProfiles");
    ensureDir(storeDir);

    function getUserIdFromToken(req) {
        const token = req.header("X-Addon-Token");
        if (!token) return null;
        const jwt = decodeJwtPayload(token);
        return jwt.user;
    }

    function fileForUser(userId) {
        return path.join(storeDir, `${userId}.json`);
    }

    function defaultProfile() {
        return {
            name: "",
            taxId: "",
            address: "",
            email: "",
            paymentDetails: "",
            notes: "",
            logoDataUrl: "",
            rate: "",
            currency: "USD",

            baseRateIsEur: false,

            invoicePrefix: "INV",
            irpfPercent: "",
            vatPercent: "",
            nextInvoiceCounter: 1,
        };
    }

    // GET current profile
    app.get("/api/vendor-profile", (req, res) => {
        const userId = getUserIdFromToken(req);
        if (!userId) return res.status(401).send("Missing X-Addon-Token");

        const fp = fileForUser(userId);
        const profile = readJson(fp, defaultProfile());

        // ✅ ensure logoDataUrl exists (migrate older files)
        if (typeof profile.logoDataUrl !== "string") {
            profile.logoDataUrl = "";
            writeJson(fp, profile);
        }

        // ✅ ensure baseRateIsEur exists (migrate older files)
        if (typeof profile.baseRateIsEur !== "boolean") {
            profile.baseRateIsEur = false;
            writeJson(fp, profile);
        }

        // migrate legacy field names if needed
        if (profile.nextInvoiceCounter == null) {
            const legacy = profile.nextInvoiceNumber ?? null;
            if (legacy != null) profile.nextInvoiceCounter = Math.max(1, parseInt(String(legacy), 10) || 1);
            else profile.nextInvoiceCounter = 1;
            delete profile.nextInvoiceNumber;
            writeJson(fp, profile);
        }

        res.json(profile);
    });

    // POST update profile
    app.post("/api/vendor-profile", (req, res) => {
        const userId = getUserIdFromToken(req);
        if (!userId) return res.status(401).send("Missing X-Addon-Token");

        const fp = fileForUser(userId);
        const current = readJson(fp, defaultProfile());
        const body = req.body || {};

        // normalize current counter (migration)
        const currentCounter =
            current.nextInvoiceCounter ??
            current.nextInvoiceNumber ??
            1;

        const updated = {
            ...current,

            name: (body.name || "").trim(),
            taxId: (body.taxId || "").trim(),
            address: (body.address || "").trim(),
            email: (body.email || "").trim(),
            paymentDetails: (body.paymentDetails || "").trim(),
            notes: (body.notes || "").trim(),

            rate: body.rate === "" ? "" : toNumOrEmpty(body.rate),

            currency: (body.currency || "USD").trim().toUpperCase(),
            logoDataUrl: sanitizeLogoDataUrl(body.logoDataUrl),

            baseRateIsEur:
                ((body.currency || "USD").trim().toUpperCase() === "EUR")
                    ? !!body.baseRateIsEur
                    : false,

            invoicePrefix: (body.invoicePrefix || "INV").trim() || "INV",
            irpfPercent: body.irpfPercent === "" ? "" : toNumOrEmpty(body.irpfPercent),
            vatPercent: body.vatPercent === "" ? "" : toNumOrEmpty(body.vatPercent),
            nextInvoiceCounter: currentCounter,
        };

        if (updated.currency !== "EUR") updated.baseRateIsEur = false;

        // ✅ NEW BEHAVIOR:
        // If user provides a counter value, ALWAYS set it (allow resets / jumps).
        // Accept either startCount or nextInvoiceCounter from UI.
        const overrideCounter =
            toIntOrNull(body.nextInvoiceCounter) ??
            toIntOrNull(body.startCount);

        if (overrideCounter != null) {
            updated.nextInvoiceCounter = Math.max(1, overrideCounter);
        }

        // clean legacy
        delete updated.nextInvoiceNumber;

        writeJson(fp, updated);
        res.json({ ok: true });
    });
};