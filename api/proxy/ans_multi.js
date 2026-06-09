import { multiCityData, latestMonth } from "../_lib/ans.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const uf = (req.query.uf || "").toString().toUpperCase();
  const codsStr = (req.query.cods || "").toString();
  const cods = codsStr.split(",").map(s => s.trim()).filter(Boolean);
  if (!uf || !cods.length) return res.status(400).json({ error: "uf e cods obrigatórios" });

  const ym = latestMonth(uf);
  if (!ym) {
    return res.status(200).json({
      month: null,
      total: 0, mh: 0, odonto: 0,
      operadoras: [], cities: {},
      _notice: `Dados ANS para UF ${uf} ainda não foram pré-processados no servidor.`,
    });
  }
  try {
    const data = multiCityData(uf, cods, ym);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
