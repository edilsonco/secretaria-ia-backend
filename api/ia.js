/* api/ia.js  –  Secretaria IA (fuso: América/São Paulo) */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/* ─── 1. Instâncias ───────────────────────────────────── */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ─── 2. Utilidades ───────────────────────────────────── */

/** Converte frase “05/05/2025 às 19h” ou “2025-05-05 19:30” em string ISO já com
 *  fuso −03:00  (Brasil – horário padrão de São Paulo).                       */
function parseDateTime(texto) {
  // data     05/05/2025  ou  2025-05-05   (opcional)
  // hora     19h, 19:00, 19h30, 7h, 07:00, etc.   (obrigatória)
  const rx = /(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}(?:\/\d{4})?)?[^0-9]*(\d{1,2})(?::|h)?(\d{2})?\s?(?:h|horas?)?/iu;
  const m = texto.match(rx);
  if (!m) return null;

  /* ----- Data ----- */
  let [dataRaw] = m;
  const dataTxt = m[1];
  let isoDate;
  if (dataTxt) {
    isoDate = dataTxt.includes('-')
      ? dataTxt                                  // YYYY-MM-DD
      : dataTxt.split('/').reverse().join('-');  // DD/MM/YYYY → YYYY-MM-DD
  } else {
    isoDate = new Date().toISOString().slice(0, 10); // hoje
  }

  /* ----- Hora ----- */
  const hh  = m[2].padStart(2, '0');
  const mm  = (m[3] ?? '00').padEnd(2, '0');

  /*   ISO local:  YYYY-MM-DD T HH:MM:00-03:00   */
  return `${isoDate}T${hh}:${mm}:00-03:00`;
}

/** Extrai nome da pessoa/assunto após “com …”   */
function pessoaDoTexto(txt) {
  const m = txt.match(/com ([\p{L}\s]+)/iu);
  return m ? m[1].trim() : null;
}
function tituloComp(txt) {
  const nome = pessoaDoTexto(txt) ?? 'Contato';
  return `Reunião com ${nome}`;
}

/* Verbos de ação */
const V_MARCAR  = ['marque','marcar','marca','agende','agendar','agenda','reserve','reservar'];
const V_CANCEL  = ['desmarque','desmarcar','cancele','cancelar','cancela','remova','remover'];
const V_ALTERAR = ['altere','alterar','mude','muda','troque','troca','edite','editar'];

/* ─── 3. Handler ─────────────────────────────────────── */
export default async function handler(req, res) {
  /* CORS */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem } = req.body ?? {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  const txt = mensagem.toLowerCase();

  /* ── MARCAR ─────────────────────── */
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

  /* ── CANCELAR ───────────────────── */
  if (V_CANCEL.some(v => txt.includes(v))) {
    const pessoa = pessoaDoTexto(mensagem);
    if (!pessoa) return res.json({ resposta: 'Qual compromisso devo cancelar?' });

    await supabase
      .from('appointments')
      .update({ status: 'cancelado' })
      .ilike('titulo', `%${pessoa}%`);

    return res.json({ resposta: `Compromisso relacionado a ${pessoa} cancelado.` });
  }

  /* ── ALTERAR ────────────────────── */
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

  /* ── LISTAR ─────────────────────── */
  const { data: rows } = await supabase
    .from('appointments')
    .select('*')
    .eq('status','marcado')
    .order('data_hora');

  if (!rows.length)
    return res.json({ resposta: 'Você não tem compromissos marcados.' });

  const lista = rows.map(r =>
    `• ${r.titulo} @ ${new Date(r.data_hora).toLocaleString('pt-BR')}`
  ).join('\n');

  return res.json({ resposta: `Lista de compromissos:\n${lista}` });
}
