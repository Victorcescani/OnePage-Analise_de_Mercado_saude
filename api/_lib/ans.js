// Helpers ANS — lê JSONs pré-processados de /data
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Em serverless Vercel, process.cwd() é a raiz do projeto
const DATA_DIR = path.join(process.cwd(), "data");

// Cache em memória por instância de função (ajuda em invocações seguidas)
const memCache = new Map();

function loadMonth(uf, ym) {
  const key = `${uf}_${ym}`;
  if (memCache.has(key)) return memCache.get(key);
  const file = path.join(DATA_DIR, `ans_${uf}_${ym}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    memCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

// Lista meses disponíveis para um UF.
export function listMonthsForUF(uf) {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const rx = new RegExp(`^ans_${uf}_(\\d{6})\\.json$`);
    const months = [];
    for (const f of files) {
      const m = f.match(rx);
      if (m) months.push(m[1]);
    }
    return months.sort();
  } catch {
    return [];
  }
}

// Mais recente disponível
export function latestMonth(uf) {
  const months = listMonthsForUF(uf);
  return months.length ? months[months.length - 1] : null;
}

// Dados de uma cidade num mês específico (ou mais recente).
export function cityData(uf, cod6, ym) {
  ym = ym || latestMonth(uf);
  if (!ym) return null;
  const data = loadMonth(uf, ym);
  if (!data) return null;
  const c = data.byCity?.[cod6] || { total: 0, mh: 0, odonto: 0, operadoras: {} };
  const ops = Object.entries(c.operadoras || {})
    .map(([razao, v]) => ({
      razao,
      modalidade: v.modalidade,
      beneficiarios: v.beneficiarios,
      mh: v.mh,
      odonto: v.odonto,
    }))
    .sort((a, b) => b.beneficiarios - a.beneficiarios);
  return {
    month: ym,
    total: c.total,
    mh: c.mh,
    odonto: c.odonto,
    operadoras: ops,
  };
}

// Soma para múltiplas cidades (microrregião).
export function multiCityData(uf, cods, ym) {
  ym = ym || latestMonth(uf);
  if (!ym) return null;
  const data = loadMonth(uf, ym);
  if (!data) return null;
  let total = 0, mh = 0, odonto = 0;
  const opsMap = {};
  const cities = {};
  for (const cod of cods) {
    const c = data.byCity?.[cod] || { total: 0, mh: 0, odonto: 0, operadoras: {} };
    cities[cod] = { total: c.total, mh: c.mh, odonto: c.odonto };
    total += c.total; mh += c.mh; odonto += c.odonto;
    for (const [razao, v] of Object.entries(c.operadoras || {})) {
      if (!opsMap[razao]) opsMap[razao] = { razao, modalidade: v.modalidade, beneficiarios: 0, mh: 0, odonto: 0 };
      opsMap[razao].beneficiarios += v.beneficiarios;
      opsMap[razao].mh += v.mh;
      opsMap[razao].odonto += v.odonto;
    }
  }
  const ops = Object.values(opsMap).sort((a, b) => b.beneficiarios - a.beneficiarios);
  return { month: ym, total, mh, odonto, operadoras: ops, cities };
}

// Série histórica (todos os meses em cache para o UF).
export function historySeries(uf, cods) {
  const months = listMonthsForUF(uf);
  const series = [];
  for (const ym of months) {
    const data = loadMonth(uf, ym);
    if (!data) continue;
    let total = 0, mh = 0, odonto = 0;
    for (const cod of cods) {
      const c = data.byCity?.[cod];
      if (!c) continue;
      total += c.total; mh += c.mh; odonto += c.odonto;
    }
    series.push({ month: ym, total, mh, odonto });
  }
  return series;
}
