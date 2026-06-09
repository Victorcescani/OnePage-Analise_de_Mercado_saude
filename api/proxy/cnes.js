// Proxy simples para CNES apidadosabertos.saude.gov.br (que não libera CORS).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const qs = new URLSearchParams(req.query).toString();
    const url = `https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?${qs}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "pesquisa-cidade/1.0", "Accept": "application/json" },
    });
    const body = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    return res.send(body);
  } catch (e) {
    return res.status(502).json({ error: "proxy_error", message: String(e.message || e) });
  }
}
