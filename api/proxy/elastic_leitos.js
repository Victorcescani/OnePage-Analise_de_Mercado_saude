import { leitosPorCidade } from "../_lib/elastic.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const cod = (req.query.cod || "").toString();
  if (!cod) return res.status(400).json({ error: "cod obrigatório" });
  try {
    const data = await leitosPorCidade(cod);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
