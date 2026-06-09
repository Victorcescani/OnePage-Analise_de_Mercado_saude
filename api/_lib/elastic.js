// Helpers ElastiCNES — proxy para o Kibana público.

const ELASTIC_BASE = "https://elasticnes.saude.gov.br/kibana/internal/search/es";

export async function elasticSearch(index, body) {
  const r = await fetch(ELASTIC_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "kbn-xsrf": "true",
      "User-Agent": "pesquisa-cidade/1.0",
    },
    body: JSON.stringify({ params: { index, body } }),
  });
  if (!r.ok) throw new Error(`elastic ${r.status}`);
  return r.json();
}

export async function elasticLatestComp(prefix = "cnes-leitosh") {
  const today = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    try {
      const r = await elasticSearch(`${prefix}-${ym}`, { size: 0 });
      const tot = r?.rawResponse?.hits?.total;
      const v = typeof tot === "object" ? tot.value : tot;
      if (v && v > 0) return ym;
    } catch {}
  }
  return null;
}

function normText(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Retorna estrutura { comp, hospitais: [...], totais: {...} } para uma cidade.
export async function leitosPorCidade(cod6, comp) {
  comp = comp || (await elasticLatestComp("cnes-leitosh"));
  if (!comp) throw new Error("sem competência disponível");

  const body = {
    size: 2000,
    query: {
      bool: {
        filter: [
          { term: { "CÓDIGO DO MUNICÍPIO.keyword": cod6 } },
          { term: { "STATUS DO ESTABELECIMENTO.keyword": "ATIVO" } },
        ],
      },
    },
    _source: [
      "CNES", "NOME FANTASIA", "RAZÃO SOCIAL",
      "TIPO DO ESTABELECIMENTO", "TIPO NOVO DO ESTABELECIMENTO",
      "NATUREZA JURÍDICA CATEGORIA", "CATEGORIA NATUREZA JURÍDICA",
      "BAIRRO", "LOGRADOURO", "TELEFONE", "E-MAIL", "location",
      "LEITO", "TIPO DO LEITO", "LEITOS EXISTENTES", "LEITOS SUS",
      "LEITOS EXISTENTES (TOTAL)", "LEITOS SUS (TOTAL)",
      "STATUS DO ESTABELECIMENTO", "COMPETÊNCIA",
    ],
  };

  const r = await elasticSearch(`cnes-leitosh-${comp}`, body);
  const hits = r?.rawResponse?.hits?.hits || [];

  // Agrupa por CNES
  const byCnes = {};
  for (const h of hits) {
    const s = h._source;
    const cnes = String(s.CNES || "").trim();
    if (!cnes) continue;
    let hosp = byCnes[cnes];
    if (!hosp) {
      hosp = byCnes[cnes] = {
        cnes,
        nome: (s["NOME FANTASIA"] || "").trim(),
        razao: (s["RAZÃO SOCIAL"] || "").trim(),
        tipo: (s["TIPO DO ESTABELECIMENTO"] || "").trim(),
        tipo_novo: (s["TIPO NOVO DO ESTABELECIMENTO"] || "").trim(),
        natureza: (s["NATUREZA JURÍDICA CATEGORIA"] || "").trim(),
        natureza_cat: (s["CATEGORIA NATUREZA JURÍDICA"] || "").trim(),
        bairro: (s["BAIRRO"] || "").trim(),
        endereco: (s["LOGRADOURO"] || "").trim(),
        telefone: (s["TELEFONE"] || "").trim(),
        email: (s["E-MAIL"] || "").trim(),
        location: s["location"],
        leitos_total: Number(s["LEITOS EXISTENTES (TOTAL)"]) || 0,
        leitos_sus_total: Number(s["LEITOS SUS (TOTAL)"]) || 0,
        status: s["STATUS DO ESTABELECIMENTO"] || "",
        comp: s["COMPETÊNCIA"] || "",
        leitos: [],
      };
    }
    hosp.leitos.push({
      tipo: (s["LEITO"] || "").toString(),
      categoria: (s["TIPO DO LEITO"] || "").toString(),
      existentes: Number(s["LEITOS EXISTENTES"]) || 0,
      sus: Number(s["LEITOS SUS"]) || 0,
    });
  }

  // Normaliza + agrupa leitos por tipo
  for (const cnes of Object.keys(byCnes)) {
    const h = byCnes[cnes];
    h.leitos_privados_total = Math.max(h.leitos_total - h.leitos_sus_total, 0);
    const agg = {};
    for (const l of h.leitos) {
      const k = l.tipo;
      if (!agg[k]) agg[k] = { tipo: k, categoria: l.categoria, existentes: 0, sus: 0 };
      agg[k].existentes += l.existentes;
      agg[k].sus += l.sus;
    }
    for (const v of Object.values(agg)) v.privados = Math.max(v.existentes - v.sus, 0);
    h.leitos = Object.values(agg).sort((a, b) => b.existentes - a.existentes);
  }

  // Consolida CNES do mesmo complexo (mesmo nome + razão social).
  const consolidated = {};
  for (const h of Object.values(byCnes)) {
    const key = `${normText(h.nome)}|${normText(h.razao)}`;
    const cur = consolidated[key];
    if (!cur) {
      consolidated[key] = {
        ...h,
        cnes_unidades: [h.cnes],
        num_unidades: 1,
        __primary_leitos: h.leitos_total,
      };
    } else {
      cur.leitos_total += h.leitos_total;
      cur.leitos_sus_total += h.leitos_sus_total;
      cur.leitos_privados_total += h.leitos_privados_total;
      // Merge lista de leitos por tipo
      const map = {};
      for (const lt of [...cur.leitos, ...h.leitos]) {
        const k = lt.tipo;
        if (!map[k]) map[k] = { tipo: k, categoria: lt.categoria, existentes: 0, sus: 0, privados: 0 };
        map[k].existentes += lt.existentes;
        map[k].sus += lt.sus;
        map[k].privados += lt.privados || 0;
      }
      cur.leitos = Object.values(map).sort((a, b) => b.existentes - a.existentes);
      cur.cnes_unidades.push(h.cnes);
      cur.num_unidades += 1;
      // Atualiza "unidade principal" se a nova for maior
      if (h.leitos_total > cur.__primary_leitos) {
        for (const k of ["cnes", "bairro", "endereco", "telefone", "email", "location", "tipo", "tipo_novo", "natureza", "natureza_cat"]) {
          cur[k] = h[k];
        }
        cur.__primary_leitos = h.leitos_total;
      }
    }
  }

  const hospitais = Object.values(consolidated)
    .map(h => { delete h.__primary_leitos; return h; })
    .sort((a, b) => b.leitos_total - a.leitos_total);

  const totais = {
    existentes: hospitais.reduce((s, h) => s + h.leitos_total, 0),
    sus: hospitais.reduce((s, h) => s + h.leitos_sus_total, 0),
    privados: hospitais.reduce((s, h) => s + h.leitos_privados_total, 0),
  };

  return { comp, hospitais, totais };
}

// Agregação leve: total de leitos (existentes / SUS) e contagem de hospitais
// para uma ou mais cidades, em uma competência específica.
export async function leitosTotaisAgg(cods, comp) {
  if (!comp) return null;
  const codArr = Array.isArray(cods) ? cods : [cods];
  const body = {
    size: 0,
    query: {
      bool: {
        filter: [
          { terms: { "CÓDIGO DO MUNICÍPIO.keyword": codArr } },
          { term: { "STATUS DO ESTABELECIMENTO.keyword": "ATIVO" } },
        ],
      },
    },
    aggs: {
      total: { sum: { field: "LEITOS EXISTENTES" } },
      sus: { sum: { field: "LEITOS SUS" } },
      hospitais: { cardinality: { field: "CNES.keyword" } },
    },
  };
  const r = await elasticSearch(`cnes-leitosh-${comp}`, body);
  const aggs = r?.rawResponse?.aggregations;
  if (!aggs) return null;
  const total = Number(aggs.total?.value || 0);
  const sus = Number(aggs.sus?.value || 0);
  return {
    comp,
    total,
    sus,
    privados: Math.max(total - sus, 0),
    hospitais: Number(aggs.hospitais?.value || 0),
  };
}

// Para um ano dado, encontra a competência mais recente com dados.
// Para anos passados, tenta Dez → Jun → Jan; para o ano corrente, usa o latest global.
async function compForYear(year, latestGlobal) {
  if (latestGlobal && latestGlobal.startsWith(String(year))) return latestGlobal;
  for (const m of [12, 6, 1]) {
    const ym = `${year}${String(m).padStart(2, "0")}`;
    try {
      const r = await elasticSearch(`cnes-leitosh-${ym}`, { size: 0 });
      const tot = r?.rawResponse?.hits?.total;
      const v = typeof tot === "object" ? tot.value : tot;
      if (v && v > 0) return ym;
    } catch {}
  }
  return null;
}

// Série anual para uma ou mais cidades. Usa um snapshot por ano (último com dados).
export async function leitosHistory(cods, nYears = 6) {
  const latestComp = await elasticLatestComp("cnes-leitosh");
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - nYears + 1;
  const years = [];
  for (let y = startYear; y <= currentYear; y++) years.push(y);

  const results = await Promise.all(years.map(async y => {
    const comp = await compForYear(y, latestComp);
    if (!comp) return null;
    try {
      const agg = await leitosTotaisAgg(cods, comp);
      return agg ? { year: y, ...agg } : null;
    } catch { return null; }
  }));
  return results.filter(Boolean).sort((a, b) => a.year - b.year);
}

export async function servicosPorHospital(cnes, comp) {
  comp = comp || (await elasticLatestComp("cnes-leitosh"));
  if (!comp) return { comp: null, servicos: [] };
  const body = {
    size: 500,
    query: { bool: { filter: [{ term: { "CNES.keyword": cnes } }] } },
    _source: [
      "SERVIÇO - DESCRIÇÃO", "SERVIÇO CLASSIFICAÇÃO - DESCRIÇÃO",
      "SERVIÇO - AMBULATORIAL SUS", "SERVIÇO - AMBULATORIAL NÃO SUS",
      "SERVIÇO - HOSPITALAR SUS", "SERVIÇO - HOSPITALAR NÃO SUS",
    ],
  };
  try {
    const r = await elasticSearch(`cnes-servicos-${comp}`, body);
    const hits = r?.rawResponse?.hits?.hits || [];
    const grouped = {};
    for (const h of hits) {
      const s = h._source;
      const key = (s["SERVIÇO - DESCRIÇÃO"] || "").toString();
      if (!key) continue;
      if (!grouped[key]) grouped[key] = { servico: key, classificacoes: [], sus: false, nao_sus: false };
      const cls = (s["SERVIÇO CLASSIFICAÇÃO - DESCRIÇÃO"] || "").toString();
      if (cls && !grouped[key].classificacoes.includes(cls)) grouped[key].classificacoes.push(cls);
      if (s["SERVIÇO - AMBULATORIAL SUS"] === "Sim" || s["SERVIÇO - HOSPITALAR SUS"] === "Sim") grouped[key].sus = true;
      if (s["SERVIÇO - AMBULATORIAL NÃO SUS"] === "Sim" || s["SERVIÇO - HOSPITALAR NÃO SUS"] === "Sim") grouped[key].nao_sus = true;
    }
    return { comp, servicos: Object.values(grouped).sort((a, b) => a.servico.localeCompare(b.servico)) };
  } catch (e) {
    return { comp, servicos: [], error: String(e.message || e) };
  }
}
