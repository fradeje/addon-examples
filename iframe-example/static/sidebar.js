(async () => {
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
        return (String(profile.invoicePrefix || "INV").trim() || "INV");
    }

    function renderNextInvoiceNumber(profile = {}, typedOverride = {}) {
        const prefix = (typedOverride.invoicePrefix ?? getPrefix(profile)).trim() || "INV";

        // show typed counter if present, else saved
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

        // initial paint
        update();
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
        set("v_rate", p.rate ?? "");
        set("v_currency", p.currency || "USD");

        set("v_invoicePrefix", getPrefix(p));

        // ✅ now editable: show current next counter value
        set("v_startCount", getNextCounter(p));

        set("v_irpfPercent", p.irpfPercent ?? "");

        // paint read-only preview
        renderNextInvoiceNumber(p);
    }

    function readForm() {
        const get = (id) => (document.getElementById(id)?.value ?? "").trim();

        const nextCounterStr = get("v_startCount");
        const nextInvoiceCounter = nextCounterStr === "" ? null : parseInt(nextCounterStr, 10);

        return {
            name: get("v_name"),
            taxId: get("v_taxId"),
            address: get("v_address"),
            email: get("v_email"),
            paymentDetails: get("v_paymentDetails"),
            rate: get("v_rate"),
            currency: get("v_currency"),

            invoicePrefix: get("v_invoicePrefix"),
            irpfPercent: get("v_irpfPercent"),

            // ✅ NEW: store editable counter
            nextInvoiceCounter: Number.isFinite(nextInvoiceCounter) ? nextInvoiceCounter : null,

            // backward compatibility (your backend accepts either)
            startCount: Number.isFinite(nextInvoiceCounter) ? nextInvoiceCounter : "",
        };
    }

    function profileMissingFields(p) {
        const missing = [];
        if (!p?.name) missing.push("Name / Business name");
        if (!p?.taxId) missing.push("Tax ID");
        if (!p?.address) missing.push("Address");
        if (!p?.email) missing.push("Email");
        if (p?.rate == null || p?.rate === "" || Number(p.rate) <= 0) missing.push("Hourly rate");
        if (!p?.currency) missing.push("Currency");
        return missing;
    }

    // ---------- Reports preview ----------
    async function fetchApprovedBillableReport({ reportsUrl, workspaceId, userId, token, ym }) {
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

        return res.json();
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

    const jwt = decodeJwt(token);
    const userId = parsedURL.searchParams.get("userId") || jwt.user;
    const workspaceId = jwt.workspaceId;
    const reportsUrl = jwt.reportsUrl;
    const backendUrl = jwt.backendUrl;

    if (dbg) {
        dbg.textContent = JSON.stringify(
            { workspaceId, backendUrl, reportsUrl, userId },
            null,
            2
        );
    }

    // Load profile on open
    let cachedProfile = {};
    const cachedProfileRef = { current: cachedProfile };

    try {
        cachedProfile = await loadProfile(token);
        cachedProfileRef.current = cachedProfile;
        fillForm(cachedProfile);
    } catch (e) {
        console.warn("Could not load profile:", e);
    }

    wireNextInvoiceLivePreview(cachedProfileRef);

    // Save profile button
    const saveBtn = document.getElementById("saveProfile");
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            try {
                if (saveStatusEl) saveStatusEl.textContent = "Saving…";
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
    const btn = document.getElementById("btn");
    if (!btn) return;

    btn.addEventListener("click", async () => {
        const ym = document.getElementById("month")?.value;
        const format = document.getElementById("format")?.value || "preview";

        // refresh profile
        try {
            cachedProfile = await loadProfile(token);
            cachedProfileRef.current = cachedProfile;
            fillForm(cachedProfile);
        } catch (e) {
            console.warn("Could not refresh profile:", e);
        }

        if (format === "pdf") {
            const missing = profileMissingFields(cachedProfile);
            if (missing.length) {
                if (statusEl) {
                    statusEl.textContent = "Complete Settings first";
                    statusEl.className = "bad";
                }
                if (dbg) dbg.textContent = JSON.stringify({ missing }, null, 2);
                switchToTab("settings");
                return;
            }

            try {
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

                // filename*=UTF-8''...
                const mStar = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
                if (mStar) filename = decodeURIComponent(mStar[1]);

                // filename="..."
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

                // reload after PDF so counter increments in UI
                try {
                    cachedProfile = await loadProfile(token);
                    cachedProfileRef.current = cachedProfile;
                    fillForm(cachedProfile);
                } catch (e) {
                    console.warn("Could not reload profile after PDF:", e);
                }

                if (statusEl) {
                    statusEl.textContent = "PDF downloaded ✅";
                    statusEl.className = "ok";
                }
                return;
            } catch (e) {
                if (statusEl) {
                    statusEl.textContent = "Error";
                    statusEl.className = "bad";
                }
                if (dbg) dbg.textContent = String(e);
                console.error(e);
                return;
            }
        }

        // Preview JSON
        try {
            if (statusEl) {
                statusEl.textContent = "Loading…";
                statusEl.className = "";
            }

            const data = await fetchApprovedBillableReport({
                reportsUrl,
                workspaceId,
                userId,
                token,
                ym,
            });

            const totals = pickTotalsFromSummaryResponse(data);
            if (!totals) {
                if (statusEl) {
                    statusEl.textContent = "No data";
                    statusEl.className = "bad";
                }
                if (dbg) dbg.textContent = JSON.stringify({ raw: data }, null, 2);
                return;
            }

            const billableSeconds =
                totals.totalBillableTime ??
                totals.billableTime ??
                totals.totalTime ??
                totals.duration ??
                0;

            const billableHours = secondsToHours(billableSeconds);

            const rate = Number(cachedProfile?.rate || 0);
            const currency = (cachedProfile?.currency || "USD").toUpperCase();
            const irpfPercent = Number(cachedProfile?.irpfPercent || 0);

            const subtotalCents = moneyCentsFrom(billableHours, rate);
            const irpfCents = irpfPercent > 0 ? Math.round(subtotalCents * (irpfPercent / 100)) : 0;
            const totalDueCents = subtotalCents - irpfCents;

            if (statusEl) {
                statusEl.textContent = "Preview ready ✅";
                statusEl.className = "ok";
            }

            if (dbg) {
                dbg.textContent = JSON.stringify(
                    {
                        month: ym,
                        billableHours,
                        nextInvoiceNumber: `${getPrefix(cachedProfile)}-${getNextCounter(cachedProfile)}`,
                        computed: {
                            subtotal: `${currency} ${centsToMoney(subtotalCents)}`,
                            irpfPercent,
                            irpf: irpfCents ? `- ${currency} ${centsToMoney(irpfCents)}` : "0.00",
                            totalDue: `${currency} ${centsToMoney(totalDueCents)}`,
                        },
                        rawTotals: totals,
                    },
                    null,
                    2
                );
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
})();