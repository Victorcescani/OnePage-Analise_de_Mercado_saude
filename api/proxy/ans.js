import { cityData, latestMonth } from "../_lib/ans.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const uf = (req.query.uf || "").toString().toUpperCase();
  const cod = (req.query.cod || "").toString();
  if (!uf || !cod) return res.status(400).json({ error: "uf e cod obrigatórios" });

  const ym = latestMonth(uf);
  if (!ym) {
    return res.status(200).json({
      month: null,
      total: 0, mh: 0, odonto: 0,
      operadoras: [],
      _notice: `Dados ANS para UF ${uf} ainda não foram pré-processados no servidor. No momento só RS está disponível.`,
    });
  }
  try {
    const data = cityData(uf, cod, ym);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
