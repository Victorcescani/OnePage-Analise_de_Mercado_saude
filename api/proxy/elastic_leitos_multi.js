import { leitosPorCidade } from "../_lib/elastic.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const codsStr = (req.query.cods || "").toString();
  const cods = codsStr.split(",").map(s => s.trim()).filter(Boolean);
  if (!cods.length) return res.status(400).json({ error: "cods obrigatório" });

  try {
    const hospitais = [];
    let comp = null;
    for (const c of cods) {
      try {
        const d = await leitosPorCidade(c, comp || undefined);
        comp = comp || d.comp;
        for (const h of d.hospitais) hospitais.push({ ...h, cod_ibge: c });
      } catch {}
    }
    hospitais.sort((a, b) => b.leitos_total - a.leitos_total);
    const totais = {
      existentes: hospitais.reduce((s, h) => s + h.leitos_total, 0),
      sus: hospitais.reduce((s, h) => s + h.leitos_sus_total, 0),
      privados: hospitais.reduce((s, h) => s + h.leitos_privados_total, 0),
    };
    return res.status(200).json({ comp, hospitais, totais });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
