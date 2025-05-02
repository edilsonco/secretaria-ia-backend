/* api/ia.js  – secretaria virtual (fuso America/Sao_Paulo) */
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/* 1. Instâncias */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* 2. Utilidades */
// detecta hora 17h, 17:30, 17 horas, 17:00
const HORA_RE = /(?:\b[àa]s?\s+|\s)(\d{1,2})(?:[:h](\d{2}))?\s?(?:h|horas?)?\b/i;
// detecta data 05/05/2025 ou 2025-05-05
const DATA_RE = /\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/;

function parseDateTime(txt) {
  const horaM = txt.match(HORA_RE);
  if (!horaM) return null;                                    // hora obrigatória
  const hh = horaM[1].padStart(2, '0');
  const mm = (horaM[2] ?? '00').padEnd(2, '0');

  const dataM = txt.match(DATA_RE);
  let isoDate;

  if (dataM) {
    isoDate = dataM[1].includes('-')
      ? dataM[1]                                 // AAAA-MM-DD
      : dataM[1].split('/').reverse().join('-'); // DD/MM/AAAA
  } else if (/\bamanh[ãa]\b/i.test(txt)) {
    const d = new Date();           // hoje no fuso local
    d.setDate(d.getDate() + 1);     // +1 dia
    isoDate = d.toISOString().slice(0, 10);
  } else {
    isoDate = new Date().toISOString().slice(0, 10); // hoje
  }

  return `${isoDate}T${hh}:${mm}:00-03:00`;          // fixa UTC-3
}

function pessoa(txt) {
  // pega só até primeira vírgula ou palavra “amanhã”
  const m = txt.match(/com ([\p{L}\s]+?)(?:\,|\s+amanh[ãa]|$)/iu);
  return m ? m[1].trim() : null;
}
const brTime = iso =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/* verbos */
const MARCAR  = ['marque','marcar','marca','agende','agendar','agenda','reserve','reservar'];
const CANCEL  = ['desmarque','desmarcar','cancele','cancelar','cancela','remova','remover'];
const ALTERAR = ['altere','alterar','mude','muda','troque','troca','edite','editar'];

/* 3. Handler */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem } = req.body ?? {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });
  const txt = mensagem.toLowerCase();

  /* MARCAR */
  if (MARCAR.some(v => txt.includes(v))) {
    const iso = parseDateTime(mensagem);
    const nome = pessoa(mensagem) ?? 'Contato';
    const titulo = `Reunião com ${nome}`;
    await supabase.from('appointments').insert({ titulo, data_hora: iso, status: 'marcado' });
    return res.json({ resposta: `Compromisso "${titulo}" marcado para ${brTime(iso)}.` });
  }

  /* CANCELAR */
  if (CANCEL.some(v => txt.includes(v))) {
    const nome = pessoa(mensagem);
    if (!nome) return res.json({ resposta: 'Qual compromisso devo cancelar?' });
    await supabase.from('appointments')
      .update({ status: 'cancelado' })
      .ilike('titulo', `%${nome}%`);
    return res.json({ resposta: `Compromisso com ${nome} cancelado.` });
  }

  /* ALTERAR */
  if (ALTERAR.some(v => txt.includes(v))) {
    const nome = pessoa(mensagem);
    const nova = parseDateTime(mensagem);
    if (!nome || !nova)
      return res.json({ resposta: 'Preciso saber quem e nova data/hora.' });
    await supabase.from('appointments')
      .update({ data_hora: nova, status: 'remarcado' })
      .ilike('titulo', `%${nome}%`);
    return res.json({ resposta: `Compromisso com ${nome} remarcado para ${brTime(nova)}.` });
  }

  /* LISTAR */
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('status','marcado')
    .order('data_hora');
  if (!data.length)
    return res.json({ resposta: 'Você não tem compromissos marcados.' });
  const lista = data.map(r => `• ${r.titulo} @ ${brTime(r.data_hora)}`).join('\n');
  return res.json({ resposta: `Lista de compromissos:\n${lista}` });
}
