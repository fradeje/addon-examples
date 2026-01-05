(async () => {

    function setDebugVisibility(show) {
        const dbg = document.getElementById("dbg");
        if (dbg) dbg.style.display = show ? "" : "none";
    }

    const downloadBtn = document.getElementById("downloadPdfBtn");
    const formatEl = document.getElementById("format");
    const btn = document.getElementById("btn");

    function syncButtonsForFormat() {
        const fmt = formatEl?.value || "preview";
        if (btn) btn.textContent = (fmt === "pdf") ? "Load preview" : "Generate preview";
        if (downloadBtn) downloadBtn.style.display = "none";
        setDebugVisibility(fmt !== "pdf");
    }
    formatEl?.addEventListener("change", () => {
        syncButtonsForFormat();
        clearProjectsPreview();
    });
    syncButtonsForFormat();

    async function downloadPdfForMonth({ ym, token }) {
        if (statusEl) {
            statusEl.textContent = "Generating PDF…";
            statusEl.className = "";
        }

        const res = await fetch(`/invoice.pdf?month=${encodeURIComponent(ym)}`, {
            headers: { "X-Addon-Token": token },
        });

        if (!res.ok) throw new Error(await res.text());

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        const cd = res.headers.get("Content-Disposition") || "";
        let filename = null;

        const mStar = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        if (mStar) filename = decodeURIComponent(mStar[1]);

        if (!filename) {
            const m = cd.match(/filename\s*=\s*"([^"]+)"/i) || cd.match(/filename\s*=\s*([^;]+)/i);
            if (m) filename = (m[1] || "").trim();
        }

        const a = document.createElement("a");
        a.href = url;
        a.download = filename || `invoice-${ym}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        if (statusEl) {
            statusEl.textContent = "PDF downloaded ✅";
            statusEl.className = "ok";
        }
    }

    function fmtMoney(currency, amount) {
        return `${currency} ${money2(amount)}`;
    }

    function renderProjectsPreview({
        ym,
        invoiceNumber,
        currency,
        rateToUse,
        conversionComment,
        projectLines,
        vatPercent,
        vatCents,
        irpfPercent,
        irpfCents,
        subtotalCents,
        totalDueCents
    }) {
        const wrap = document.getElementById("projectsPreview");
        const meta = document.getElementById("previewMeta");
        const fx = document.getElementById("previewFx");
        const kpis = document.getElementById("previewKpis");
        const rowsEl = document.getElementById("previewRows");
        const totalsEl = document.getElementById("previewTotals");

        if (!wrap || !meta || !kpis || !rowsEl || !totalsEl) return;

        wrap.style.display = "";
        meta.textContent = `Month: ${ym} • Next invoice: ${invoiceNumber}`;

        if (conversionComment) {
            if (fx) {
                fx.style.display = "";
                fx.textContent = conversionComment;
            }
        } else {
            if (fx) {
                fx.style.display = "none";
                fx.textContent = "";
            }
        }

        // KPIs
        const totalHours = projectLines.reduce((s, x) => s + (Number(x.hours) || 0), 0);
        kpis.innerHTML = `
    <div class="preview-kpi">
      <div class="k">Effective rate</div>
      <div class="v">${currency} ${money2(rateToUse)}</div>
    </div>
    <div class="preview-kpi">
      <div class="k">Total hours</div>
      <div class="v">${money2(totalHours)}</div>
    </div>
    <div class="preview-kpi">
      <div class="k">Subtotal</div>
      <div class="v">${currency} ${centsToMoney(subtotalCents)}</div>
    </div>
  `;

        // Table rows
        rowsEl.innerHTML = projectLines
            .map(
                (r) => `
      <tr>
        <td>${escapeHtml(r.project)}</td>
        <td class="num">${money2(r.hours)}</td>
        <td class="num">${r.rate}</td>
        <td class="num">${r.amount}</td>
      </tr>
    `
            )
            .join("");

        // Totals
        const showVat = Number(vatPercent) > 0;
        const showIrpf = Number(irpfPercent) > 0;

        totalsEl.innerHTML = `
    <div class="preview-total-row"><span>Subtotal</span><strong>${currency} ${centsToMoney(subtotalCents)}</strong></div>
    ${showVat ? `<div class="preview-total-row muted"><span>IGIC/IVA (${money2(vatPercent)}%)</span><span>+ ${currency} ${centsToMoney(vatCents)}</span></div>` : ""}
    ${showIrpf ? `<div class="preview-total-row muted"><span>IRPF (${money2(irpfPercent)}%)</span><span>- ${currency} ${centsToMoney(irpfCents)}</span></div>` : ""}
    <div class="preview-total-row"><span><strong>Total due</strong></span><strong>${currency} ${centsToMoney(totalDueCents)}</strong></div>
  `;
    }

    function clearProjectsPreview() {
        const wrap = document.getElementById("projectsPreview");
        const rowsEl = document.getElementById("previewRows");
        const totalsEl = document.getElementById("previewTotals");
        const fx = document.getElementById("previewFx");
        const meta = document.getElementById("previewMeta");
        const kpis = document.getElementById("previewKpis");

        if (wrap) wrap.style.display = "none";
        if (rowsEl) rowsEl.innerHTML = "";
        if (totalsEl) totalsEl.innerHTML = "";
        if (kpis) kpis.innerHTML = "";
        if (meta) meta.textContent = "";
        if (fx) { fx.textContent = ""; fx.style.display = "none"; }
    }

    // simple HTML escape for project names
    function escapeHtml(s) {
        return String(s ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }
    // ---------- helpers ----------
    function monthRangeUTC(ym) {
        const [y, m] = ym.split("-").map(Number);
        const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
        const end = new Date(Date.UTC(y, m, 0, 23, 59, 59));
        return { start: start.toISOString(), end: end.toISOString() };
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

    function decodeJwt(token) {
        return JSON.parse(atob(token.split(".")[1]));
    }

    function pickTotalsFromSummaryResponse(data) {
        if (Array.isArray(data?.groupOne) && data.groupOne.length > 0) return data.groupOne[0];
        if (Array.isArray(data?.groupTwo) && data.groupTwo.length > 0) return data.groupTwo[0];
        if (Array.isArray(data?.totals) && data.totals.length > 0) return data.totals[0];
        if (data?.totals && typeof data.totals === "object") return data.totals;
        if (data?.total && typeof data.total === "object") return data.total;
        return null;
    }

    // ---------- ECB FX (USD->EUR) ----------
    let fxCache = { atMs: 0, usdToEur: null, date: null };

    async function loadUsdToEurFx() {
        // cache for 6 hours
        const now = Date.now();
        if (fxCache.usdToEur && now - fxCache.atMs < 6 * 60 * 60 * 1000) return fxCache;

        const res = await fetch("/api/fx/usd-eur");
        if (!res.ok) throw new Error(await res.text());

        const data = await res.json(); // { date, usdToEur, eurToUsd }
        fxCache = { atMs: now, usdToEur: Number(data.usdToEur), date: data.date || null };
        return fxCache;
    }

    function money2(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return "0.00";
        return x.toFixed(2);
    }

    async function updateFxPreviewUI(profileMaybe) {
        const currencyEl = document.getElementById("v_currency");
        const rateEl = document.getElementById("v_rate");

        const fxWrap = document.getElementById("fxWrap");
        const out = document.getElementById("v_fxPreview");

        const eurWrap = document.getElementById("eurBaseRateWrap");
        const eurCb = document.getElementById("v_baseRateIsEur");
        const eurHint = document.getElementById("eurBaseRateHint");
        const eurLabel = document.getElementById("eurBaseRateLabel");

        if (!currencyEl || !rateEl) return;

        const selected = (currencyEl.value || "USD").toUpperCase();
        const usdRate = Number(rateEl.value || 0);

        // ---- EUR checkbox block visibility + tooltip/hint ----
        if (eurWrap && eurCb) {
            if (selected === "EUR") {
                eurWrap.style.display = "";
                const confirmText = `I confirm my rate is ${money2(usdRate)} EUR`;
                if (eurLabel) eurLabel.title = confirmText;
                if (eurHint) eurHint.textContent = confirmText;
            } else {
                eurWrap.style.display = "none";
                eurCb.checked = false; // irrelevant outside EUR
                if (eurHint) eurHint.textContent = "";
                if (eurLabel) eurLabel.title = "";
            }
        }

        // If not EUR, hide FX
        if (!fxWrap || !out) return;

        if (selected !== "EUR") {
            fxWrap.style.display = "none";
            out.value = "";
            return;
        }

        // If EUR is selected AND user confirms base rate is already EUR => hide FX conversion
        if (eurCb?.checked) {
            fxWrap.style.display = "none";
            out.value = "";
            return;
        }

        // Otherwise show FX conversion
        fxWrap.style.display = "";

        if (!Number.isFinite(usdRate) || usdRate <= 0) {
            out.value = "Set a valid hourly rate first";
            return;
        }

        try {
            out.value = "Loading ECB FX…";
            const fx = await loadUsdToEurFx();
            const usdToEur = fx.usdToEur;

            if (!Number.isFinite(usdToEur) || usdToEur <= 0) {
                out.value = "Could not load ECB FX";
                return;
            }

            const eurRate = usdRate * usdToEur;
            const datePart = fx.date ? ` (ECB ${fx.date})` : "";
            out.value = `USD ${money2(usdRate)} × ${usdToEur.toFixed(6)} = EUR ${money2(eurRate)}${datePart}`;
        } catch (e) {
            out.value = "FX error: " + String(e);
        }
    }

    // ---------- Tabs ----------
    function initTabs() {
        const buttons = document.querySelectorAll(".tab");
        const panels = {
            invoice: document.getElementById("tab-invoice"),
            settings: document.getElementById("tab-settings"),
        };
        if (!buttons.length || !panels.invoice || !panels.settings) return;

        buttons.forEach((btn) => {
            btn.addEventListener("click", () => {
                buttons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");

                Object.values(panels).forEach((p) => p.classList.remove("active"));
                panels[btn.dataset.tab].classList.add("active");
            });
        });
    }

    function switchToTab(tabName) {
        const btn = document.querySelector(`.tab[data-tab="${tabName}"]`);
        if (btn) btn.click();
    }

    // ---------- Next invoice number ----------
    function getNextCounter(profile = {}) {
        const n = profile.nextInvoiceCounter ?? profile.nextInvoiceNumber ?? 1; // legacy support
        const parsed = parseInt(String(n), 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    }

    function getPrefix(profile = {}) {
        return String(profile.invoicePrefix || "INV").trim() || "INV";
    }

    function renderNextInvoiceNumber(profile = {}, typedOverride = {}) {
        const prefix = (typedOverride.invoicePrefix ?? getPrefix(profile)).trim() || "INV";

        const rawCounter = typedOverride.nextInvoiceCounter ?? getNextCounter(profile);
        const counter = Math.max(1, parseInt(String(rawCounter), 10) || 1);

        const el = document.getElementById("v_nextInvoiceNumber");
        if (el) el.value = `${prefix}-${counter}`;
    }

    function wireNextInvoiceLivePreview(cachedProfileRef) {
        const prefixEl = document.getElementById("v_invoicePrefix");
        const counterEl = document.getElementById("v_startCount"); // reused as editable counter

        const update = () => {
            const typedPrefix = (prefixEl?.value ?? "").trim();
            const typedCounter = (counterEl?.value ?? "").trim();

            renderNextInvoiceNumber(cachedProfileRef.current, {
                invoicePrefix: typedPrefix || undefined,
                nextInvoiceCounter: typedCounter ? typedCounter : undefined,
            });
        };

        prefixEl?.addEventListener("input", update);
        counterEl?.addEventListener("input", update);

        update();
    }

    // ---------- Clockify rate fetch (NEW) ----------
    async function fetchClockifyHourlyRate({ backendUrl, workspaceId, userId, token }) {
        const base = String(backendUrl || "").replace(/\/+$/, ""); // trim trailing slash
        const url = `${base}/v1/workspaces/${workspaceId}/users?memberships=WORKSPACE`;

        const res = await fetch(url, {
            method: "GET",
            headers: { "X-Addon-Token": token },
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Clockify users endpoint failed ${res.status}: ${txt}`);
        }

        const users = await res.json();
        if (!Array.isArray(users)) return null;

        const u = users.find((x) => String(x?.id) === String(userId));
        if (!u) return null;

        // Clockify returns memberships; we need the WORKSPACE membership hourlyRate
        const memberships = Array.isArray(u.memberships) ? u.memberships : [];
        const m =
            memberships.find((mm) => mm?.membershipType === "WORKSPACE") ||
            memberships.find((mm) => mm?.membershipType) ||
            null;

        const hr = m?.hourlyRate || u?.hourlyRate || null;
        const amount = hr?.amount;
        const currency = hr?.currency;

        if (amount == null) return null;

        const amountCents = Number(amount);
        if (!Number.isFinite(amountCents)) return null;

        return {
            amountCents,
            rate: Math.round((amountCents / 100) * 100) / 100, // 2 decimals
            currency: (currency || "").toUpperCase() || null,
        };
    }

    function lockRateInput(rateInfo) {
        const rateEl = document.getElementById("v_rate");
        if (!rateEl) return;

        // fill value if available
        if (rateInfo && rateInfo.rate != null) {
            rateEl.value = String(rateInfo.rate);
        }

        // lock UI
        rateEl.disabled = true;
        rateEl.style.background = "#f3f4f6";
        rateEl.style.cursor = "not-allowed";
        rateEl.title = "Hourly rate is managed in Clockify (Team → Members → Billable rate).";
    }

    // ---------- Profile API ----------
    async function loadProfile(token) {
        const res = await fetch("/api/vendor-profile", {
            headers: { "X-Addon-Token": token },
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    async function saveProfile(token, payload) {
        const res = await fetch("/api/vendor-profile", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Addon-Token": token,
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    // ---------- form fill/read ----------
    // We'll keep a cached Clockify rate and force it into saves + preview
    let clockifyRate = null;

    // ---------- Logo upload (optional) ----------
    let logoDataUrl = null; // persisted in vendor profile; used by PDF

    const LOGO_MAX_BYTES = 300 * 1024; // ~300KB (adjust if you want)
    const LOGO_ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

    function setLogoPreview(dataUrl) {
        const wrap = document.getElementById("v_logoPreviewWrap");
        const img = document.getElementById("v_logoPreviewImg");
        if (!wrap || !img) return;

        if (dataUrl) {
            wrap.style.display = "";
            img.src = dataUrl;
        } else {
            wrap.style.display = "none";
            img.removeAttribute("src");
        }
    }

    function clearLogo() {
        logoDataUrl = null;
        const fileEl = document.getElementById("v_logoFile");
        if (fileEl) fileEl.value = ""; // allows re-selecting same file
        setLogoPreview(null);
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Could not read file"));
            reader.onload = () => resolve(String(reader.result || ""));
            reader.readAsDataURL(file);
        });
    }

    function wireLogoUploader() {
        const fileEl = document.getElementById("v_logoFile");
        const removeBtn = document.getElementById("v_logoRemove");

        if (fileEl) {
            fileEl.addEventListener("change", async () => {
                const file = fileEl.files?.[0];
                if (!file) return;

                if (!LOGO_ALLOWED_TYPES.has(file.type)) {
                    alert("Logo must be PNG or JPG.");
                    fileEl.value = "";
                    return;
                }

                if (file.size > LOGO_MAX_BYTES) {
                    alert(`Logo is too large. Please use a smaller image (max ~${Math.round(LOGO_MAX_BYTES / 1024)}KB).`);
                    fileEl.value = "";
                    return;
                }

                try {
                    const dataUrl = await fileToDataUrl(file);
                    if (!dataUrl.startsWith("data:image/")) {
                        throw new Error("Invalid image data");
                    }
                    logoDataUrl = dataUrl;
                    setLogoPreview(logoDataUrl);
                } catch (e) {
                    console.error(e);
                    alert("Could not load logo file.");
                    fileEl.value = "";
                }
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener("click", () => {
                clearLogo();
            });
        }
    }

    function fillForm(p = {}) {
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.value = v ?? "";
        };

        set("v_name", p.name || "");
        set("v_taxId", p.taxId || "");
        set("v_address", p.address || "");
        set("v_email", p.email || "");
        set("v_paymentDetails", p.paymentDetails || "");
        set("v_notes", p.notes || "");

        // RATE: comes from Clockify if available, otherwise fallback to saved
        if (clockifyRate?.rate != null) set("v_rate", clockifyRate.rate);
        else set("v_rate", p.rate ?? "");

        // Currency stays editable
        set("v_currency", p.currency || clockifyRate?.currency || "USD");

        // ✅ base rate checkbox (only relevant when EUR; updateFxPreviewUI will hide/reset if not EUR)
        const baseCb = document.getElementById("v_baseRateIsEur");
        if (baseCb) baseCb.checked = !!p.baseRateIsEur;

        set("v_invoicePrefix", getPrefix(p));
        set("v_startCount", getNextCounter(p));
        set("v_irpfPercent", p.irpfPercent ?? "");
        set("v_vatPercent", p.vatPercent ?? p.vat ?? p.ivaIgicPercent ?? "");

        renderNextInvoiceNumber(p);

        updateFxPreviewUI(p).catch(console.warn);

        // ✅ Logo from profile (saved as data URL)
        logoDataUrl = (typeof p.logoDataUrl === "string" && p.logoDataUrl.startsWith("data:image/"))
            ? p.logoDataUrl
            : null;

        setLogoPreview(logoDataUrl);

        // also clear the file input (browser can't prefill it)
        const logoFileEl = document.getElementById("v_logoFile");
        if (logoFileEl) logoFileEl.value = "";

        // Always lock the rate input in the UI
        lockRateInput(clockifyRate);
    }

    function readForm() {
        const get = (id) => (document.getElementById(id)?.value ?? "").trim();
        const getChecked = (id) => !!document.getElementById(id)?.checked;

        const nextCounterStr = get("v_startCount");
        const nextInvoiceCounter = nextCounterStr === "" ? null : parseInt(nextCounterStr, 10);

        const forcedRate =
            clockifyRate?.rate != null
                ? clockifyRate.rate
                : get("v_rate");

        return {
            name: get("v_name"),
            taxId: get("v_taxId"),
            address: get("v_address"),
            email: get("v_email"),
            paymentDetails: get("v_paymentDetails"),
            notes: get("v_notes"),

            rate: forcedRate,
            currency: get("v_currency"),

            baseRateIsEur: getChecked("v_baseRateIsEur"),

            invoicePrefix: get("v_invoicePrefix"),
            irpfPercent: get("v_irpfPercent"),
            vatPercent: get("v_vatPercent"),
            logoDataUrl: logoDataUrl || null,

            nextInvoiceCounter: Number.isFinite(nextInvoiceCounter) ? nextInvoiceCounter : null,
            startCount: Number.isFinite(nextInvoiceCounter) ? nextInvoiceCounter : "",
        };
    }

    function profileMissingFields(p) {
        const missing = [];
        if (!p?.name) missing.push("Name / Business name");
        if (!p?.taxId) missing.push("Tax ID");
        if (!p?.address) missing.push("Address");
        if (!p?.email) missing.push("Email");

        // rate required — use Clockify rate first
        const effectiveRate =
            clockifyRate?.rate != null ? clockifyRate.rate : (p?.rate == null ? "" : p.rate);
        if (effectiveRate === "" || Number(effectiveRate) <= 0) missing.push("Hourly rate (from Clockify)");

        if (!p?.currency) missing.push("Currency");
        return missing;
    }

    // ---------- Reports preview ----------
    async function fetchApprovedBillableProjects({ reportsUrl, workspaceId, userId, token, ym }) {
        const { start, end } = monthRangeUTC(ym);

        const url = `${reportsUrl.replace(/\/$/, "")}/v1/workspaces/${workspaceId}/reports/summary`;

        const body = {
            dateRangeStart: start,
            dateRangeEnd: end,
            users: { ids: [userId] },
            billable: true,
            approvalState: "APPROVED",
            summaryFilter: { groups: ["PROJECT"] }, // ✅ PROJECT grouping
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

        const groups =
            (Array.isArray(data?.groupOne) && data.groupOne) ||
            (Array.isArray(data?.groupTwo) && data.groupTwo) ||
            [];

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

                return { project: String(name), seconds: Number(seconds || 0) };
            })
            .filter((r) => Number.isFinite(r.seconds) && r.seconds > 0);

        return { rows, raw: data };
    }

    // ---------- init ----------
    initTabs();

    // Default to previous month
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const monthEl = document.getElementById("month");
    if (monthEl) monthEl.value = d.toISOString().slice(0, 7);

    const parsedURL = new URL(document.location.href);
    const token = parsedURL.searchParams.get("auth_token");

    const dbg = document.getElementById("dbg");
    const statusEl = document.getElementById("status");
    const saveStatusEl = document.getElementById("saveStatus");

    if (!token) {
        if (statusEl) {
            statusEl.textContent = "Missing auth_token (open inside Clockify)";
            statusEl.className = "bad";
        }
        if (dbg) dbg.textContent = "Query params: " + parsedURL.searchParams.toString();
        return;
    }

    if (statusEl) {
        statusEl.textContent = "Loaded inside Clockify ✅";
        statusEl.className = "ok";
    }
    wireLogoUploader();

    const jwt = decodeJwt(token);
    const userId = parsedURL.searchParams.get("userId") || jwt.user;
    const workspaceId = jwt.workspaceId;
    const reportsUrl = jwt.reportsUrl;
    const backendUrl = jwt.backendUrl;

    if (dbg) {
        dbg.textContent = JSON.stringify({ workspaceId, backendUrl, reportsUrl, userId }, null, 2);
    }

    // Load profile on open
    let cachedProfile = {};
    const cachedProfileRef = { current: cachedProfile };

    // 1) Try to fetch Clockify rate first (so the form always shows the true rate)
    try {
        clockifyRate = await fetchClockifyHourlyRate({ backendUrl, workspaceId, userId, token });
    } catch (e) {
        console.warn("Could not fetch Clockify hourly rate:", e);
        clockifyRate = null;
    }

    try {
        cachedProfile = await loadProfile(token);
        cachedProfileRef.current = cachedProfile;
        fillForm(cachedProfile);
        await updateFxPreviewUI(cachedProfile);

        // (optional) if rate is ever editable in the future
        const rateEl = document.getElementById("v_rate");
        rateEl?.addEventListener("input", () => updateFxPreviewUI(cachedProfileRef.current));
    } catch (e) {
        console.warn("Could not load profile:", e);
        fillForm({});
    }

    wireNextInvoiceLivePreview(cachedProfileRef);

    document.getElementById("v_currency")?.addEventListener("change", async () => {
        await updateFxPreviewUI(readForm()); // uses whatever is currently on screen
    });

    document.getElementById("v_baseRateIsEur")?.addEventListener("change", async () => {
        await updateFxPreviewUI(readForm());
    });

    // Save profile button
    const saveBtn = document.getElementById("saveProfile");
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            try {
                if (saveStatusEl) saveStatusEl.textContent = "Saving…";

                // refresh Clockify rate before saving (in case admin changed it)
                try {
                    clockifyRate = await fetchClockifyHourlyRate({ backendUrl, workspaceId, userId, token });
                } catch (e) {
                    console.warn("Could not refresh Clockify hourly rate:", e);
                }

                const payload = readForm();
                await saveProfile(token, payload);

                cachedProfile = await loadProfile(token);
                cachedProfileRef.current = cachedProfile;
                fillForm(cachedProfile);

                if (saveStatusEl) saveStatusEl.textContent = "Saved ✅";
            } catch (e) {
                if (saveStatusEl) saveStatusEl.textContent = "Save failed: " + String(e);
                console.error(e);
            }
        });
    }

    // ---------- click ----------

    if (!btn) return;

    // holds latest preview state for the Download button
    let lastPreviewState = null;

    btn.addEventListener("click", async () => {
        const ym = document.getElementById("month")?.value;
        const format = document.getElementById("format")?.value || "preview";

        setDebugVisibility(format !== "pdf");
        clearProjectsPreview();
        if (downloadBtn) downloadBtn.style.display = "none";
        lastPreviewState = null;

        // refresh Clockify rate
        try {
            clockifyRate = await fetchClockifyHourlyRate({ backendUrl, workspaceId, userId, token });
        } catch (e) {
            console.warn("Could not refresh Clockify hourly rate:", e);
        }

        // refresh profile
        try {
            cachedProfile = await loadProfile(token);
            cachedProfileRef.current = cachedProfile;
            fillForm(cachedProfile);
        } catch (e) {
            console.warn("Could not refresh profile:", e);
        }

        try {
            if (statusEl) {
                statusEl.textContent = "Loading projects…";
                statusEl.className = "";
            }

            const { rows, raw } = await fetchApprovedBillableProjects({
                reportsUrl, workspaceId, userId, token, ym
            });

            if (!rows.length) {
                if (statusEl) {
                    statusEl.textContent = "No billable + approved time for this month";
                    statusEl.className = "bad";
                }
                if (dbg) dbg.textContent = JSON.stringify({ raw }, null, 2);
                return;
            }

            // base rate (Clockify wins)
            const usdRate = Number(clockifyRate?.rate ?? cachedProfile?.rate ?? 0);
            const selectedCurrency = (cachedProfile?.currency || "USD").toUpperCase();
            const baseRateIsEur = !!cachedProfile?.baseRateIsEur;

            let currency = "USD";
            let rateToUse = usdRate;
            let conversionComment = null;

            if (selectedCurrency === "EUR") {
                if (baseRateIsEur) {
                    currency = "EUR";
                    rateToUse = usdRate; // treat base as already EUR
                    conversionComment = null; // no FX line
                } else {
                    const fx = await loadUsdToEurFx();
                    const usdToEur = Number(fx.usdToEur);
                    if (Number.isFinite(usdToEur) && usdToEur > 0) {
                        currency = "EUR";
                        rateToUse = usdRate * usdToEur;
                        conversionComment =
                            `USD ${money2(usdRate)} × ${usdToEur.toFixed(6)} = EUR ${money2(rateToUse)}` +
                            (fx.date ? ` (ECB ${fx.date})` : "");
                    } else {
                        currency = "EUR";
                        conversionComment = "Could not load ECB FX rate";
                    }
                }
            }

            if (!Number.isFinite(rateToUse) || rateToUse < 0) rateToUse = 0;

            const projectLines = rows
                .map((r) => {
                    const hours = secondsToHours(r.seconds);
                    const amountCents = moneyCentsFrom(hours, rateToUse);
                    return {
                        project: r.project,
                        hours: Number(hours.toFixed(2)),
                        rate: `${currency} ${money2(rateToUse)}`,
                        amount: `${currency} ${centsToMoney(amountCents)}`,
                        amountCents,
                    };
                })
                .sort((a, b) => b.hours - a.hours);

            const subtotalCents = projectLines.reduce((s, x) => s + (x.amountCents || 0), 0);

            const irpfPercent = Number(cachedProfile?.irpfPercent || 0) || 0;
            const vatPercent = Number(cachedProfile?.vatPercent || 0) || 0;

            const vatCents = vatPercent > 0 ? Math.round(subtotalCents * (vatPercent / 100)) : 0;
            const irpfCents = irpfPercent > 0 ? Math.round(subtotalCents * (irpfPercent / 100)) : 0;
            const totalDueCents = subtotalCents + vatCents - irpfCents;

            const invoiceNumber = `${getPrefix(cachedProfile)}-${getNextCounter(cachedProfile)}`;

            renderProjectsPreview({
                ym,
                invoiceNumber,
                currency,
                rateToUse,
                conversionComment,
                projectLines,
                vatPercent,
                vatCents,
                irpfPercent,
                irpfCents,
                subtotalCents,
                totalDueCents
            });

            // still keep debug JSON if you want
            if (dbg) {
                dbg.textContent = JSON.stringify(
                    {
                        month: ym,
                        invoiceNumber,
                        fx: conversionComment || null,
                        totals: {
                            currency,
                            effectiveRate: rateToUse,
                            subtotal: `${currency} ${centsToMoney(subtotalCents)}`,
                            vatPercent,
                            irpfPercent,
                            totalDue: `${currency} ${centsToMoney(totalDueCents)}`,
                        },
                        projects: projectLines.map(({ amountCents, ...rest }) => rest),
                    },
                    null,
                    2
                );
            }

            if (statusEl) {
                statusEl.textContent = "Preview ready ✅";
                statusEl.className = "ok";
            }

            // If output is PDF, enable the 2nd step button
            if (format === "pdf" && downloadBtn) {
                lastPreviewState = { ym };
                downloadBtn.style.display = "";
            }

        } catch (e) {
            if (statusEl) {
                statusEl.textContent = "Error";
                statusEl.className = "bad";
            }
            if (dbg) dbg.textContent = String(e);
            console.error(e);
        }
    });

    downloadBtn?.addEventListener("click", async () => {
        if (!lastPreviewState?.ym) return;

        try {
            await downloadPdfForMonth({ ym: lastPreviewState.ym, token });

            // reload profile after PDF so counter increments in UI
            try {
                cachedProfile = await loadProfile(token);
                cachedProfileRef.current = cachedProfile;
                fillForm(cachedProfile);
            } catch (e) {
                console.warn("Could not reload profile after PDF:", e);
            }

            // hide download button after success (optional)
            downloadBtn.style.display = "none";
        } catch (e) {
            if (statusEl) {
                statusEl.textContent = "PDF error";
                statusEl.className = "bad";
            }
            if (dbg) dbg.textContent = String(e);
            console.error(e);
        }
    });
})();