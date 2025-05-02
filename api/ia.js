/* api/ia.js  –  Secretaria IA (fuso América/São Paulo) */
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/* ────────── 1. Instâncias ────────── */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ────────── 2. Utilidades ────────── */
/** Converte frases como:
 *  • “2025-05-05 às 19h”
 *  • “05/05/2025 19:30”
 *  • “às 18h”
 *  em ISO `YYYY-MM-DDTHH:MM:00-03:00` */
function parseDateTime(texto) {
  const dataM = texto.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/);
  const horaM = texto.match(/(?:\b[àa]s?\s+|\s)(\d{1,2})(?:[:h](\d{2}))?\s?(?:h|horas?)?\b/i);
  if (!horaM) return null;                                       // hora obrigatória

  const hh = horaM[1].padStart(2, '0');
  const mm = (horaM[2] ?? '00').padEnd(2, '0');

  let isoDate;
  if (dataM) {
    isoDate = dataM[1].includes('-')
      ? dataM[1]                                          // 2025-05-05
      : dataM[1].split('/').reverse().join('-');          // 05/05/2025 → 2025-05-05
  } else {
    isoDate = new Date().toISOString().slice(0, 10);      // hoje
  }
  return `${isoDate}T${hh}:${mm}:00-03:00`;               // UTC-3
}

function pessoaDoTexto(txt) {
  const m = txt.match(/com ([\p{L}\s]+)/iu);
  return m ? m[1].trim() : null;
}
function tituloComp(txt) {
  const nome = pessoaDoTexto(txt) ?? 'Contato';
  return `Reunião com ${nome}`;
}

/* Verbos */
const V_MARCAR  = ['marque','marcar','marca','agende','agendar','agenda','reserve','reservar'];
const V_CANCEL  = ['desmarque','desmarcar','cancele','cancelar','cancela','remova','remover'];
const V_ALTERAR = ['altere','alterar','mude','muda','troque','troca','edite','editar'];

/* ────────── 3. Handler ────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem } = req.body ?? {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  const txt = mensagem.toLowerCase();

  /* ── MARCAR ── */
  if (V_MARCAR.some(v => txt.includes(v))) {
    const iso = parseDateTime(mensagem);
    const titulo = tituloComp(mensagem);
    await supabase.from('appointments').insert({
      titulo,
      data_hora: iso,
      status: 'marcado'
    });
    const horaShow = iso
      ? new Date(iso).toLocaleString('pt-BR')
      : 'data/hora indefinidas';
    return res.json({ resposta: `Compromisso "${titulo}" marcado para ${horaShow}.` });
  }

  /* ── CANCELAR ── */
  if (V_CANCEL.some(v => txt.includes(v))) {
    const pessoa = pessoaDoTexto(mensagem);
    if (!pessoa) return res.json({ resposta: 'Qual compromisso devo cancelar?' });

    await supabase
      .from('appointments')
      .update({ status: 'cancelado' })
      .ilike('titulo', `%${pessoa}%`);

    return res.json({ resposta: `Compromisso relacionado a ${pessoa} cancelado.` });
  }

  /* ── ALTERAR ── */
  if (V_ALTERAR.some(v => txt.includes(v))) {
    const pessoa = pessoaDoTexto(mensagem);
    const novaISO = parseDateTime(mensagem);
    if (!pessoa || !novaISO)
      return res.json({ resposta: 'Preciso saber quem e nova data/hora.' });

    await supabase
      .from('appointments')
      .update({ data_hora: novaISO, status: 'remarcado' })
      .ilike('titulo', `%${pessoa}%`);

    return res.json({
      resposta: `Compromisso com ${pessoa} remarcado para ${new Date(novaISO).toLocaleString('pt-BR')}.`
    });
  }

  /* ── LISTAR ── */
  const { data: rows } = await supabase
    .from('appointments')
    .select('*')
    .eq('status', 'marcado')
    .order('data_hora');

  if (!rows.length)
    return res.json({ resposta: 'Você não tem compromissos marcados.' });

  const lista = rows.map(r =>
    `• ${r.titulo} @ ${new Date(r.data_hora).toLocaleString('pt-BR')}`
  ).join('\n');

  return res.json({ resposta: `Lista de compromissos:\n${lista}` });
}
