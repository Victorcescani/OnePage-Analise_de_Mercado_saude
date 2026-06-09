import { servicosPorHospital } from "../_lib/elastic.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const cnes = (req.query.cnes || "").toString();
  if (!cnes) return res.status(400).json({ error: "cnes obrigatório" });
  try {
    const data = await servicosPorHospital(cnes);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
