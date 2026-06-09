import { leitosHistory } from "../_lib/elastic.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const cod = (req.query.cod || "").toString().trim();
  const codsStr = (req.query.cods || "").toString().trim();
  const cods = codsStr
    ? codsStr.split(",").map(s => s.trim()).filter(Boolean)
    : (cod ? [cod] : []);
  if (!cods.length) return res.status(400).json({ error: "cod ou cods obrigatório" });

  const yearsParam = Number(req.query.years);
  const years = Number.isFinite(yearsParam) && yearsParam > 0 && yearsParam <= 10
    ? yearsParam : 6;

  try {
    const series = await leitosHistory(cods, years);
    return res.status(200).json({ series });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
