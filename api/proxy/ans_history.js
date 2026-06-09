import { historySeries } from "../_lib/ans.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const uf = (req.query.uf || "").toString().toUpperCase();
  const codsStr = (req.query.cods || "").toString();
  const cods = codsStr.split(",").map(s => s.trim()).filter(Boolean);
  if (!uf || !cods.length) return res.status(400).json({ error: "uf e cods obrigatórios" });
  try {
    const series = historySeries(uf, cods);
    return res.status(200).json({ series });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
