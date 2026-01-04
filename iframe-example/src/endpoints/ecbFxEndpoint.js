let cached = { atMs: 0, payload: null };

module.exports.registerEcbFxEndpoint = function registerEcbFxEndpoint(app) {
  app.get("/api/fx/usd-eur", async (req, res) => {
    try {
      const now = Date.now();
      if (cached.payload && now - cached.atMs < 6 * 60 * 60 * 1000) {
        return res.json(cached.payload);
      }

      const r = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
      if (!r.ok) return res.status(502).send("ECB FX fetch failed: " + r.status);
      const xml = await r.text();

      const dateMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
      const usdMatch = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/);

      if (!usdMatch) return res.status(502).send("ECB XML parse failed (USD rate not found)");

      const eurToUsd = Number(usdMatch[1]); // 1 EUR = X USD
      const usdToEur = 1 / eurToUsd;        // 1 USD = X EUR

      const payload = {
        date: dateMatch ? dateMatch[1] : null,
        eurToUsd,
        usdToEur,
      };

      cached = { atMs: now, payload };
      res.json(payload);
    } catch (e) {
      res.status(500).send(String(e));
    }
  });
};