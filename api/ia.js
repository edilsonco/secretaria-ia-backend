import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

/* ---------- utilidades ---------- */
function parseDateTime(texto) {
  const re = /(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})(?:\s+(?:à|a)s?\s+(\d{1,2}[:h]\d{2}))?/ui;
  const m = texto.match(re);
  if (!m) return null;
  const [_, dataRaw, horaRaw] = m;
  const [ano, mes, dia] = dataRaw.includes('-')
    ? dataRaw.split('-')
    : dataRaw.split('/').reverse();
  const horaMin = (horaRaw ?? '09:00').replace('h', ':').padStart(5, '0');
  return `${ano}-${mes}-${dia}T${horaMin}:00`;
}

function tituloCompromisso(texto) {
  const m = texto.match(/reuni[aã]o com ([\p{L}\s]+)/iu);
  return m ? `Reunião com ${m[1].trim()}` : texto;
}

const verbsMarcar = ['marque', 'marcar', 'marca', 'agende', 'agendar', 'agenda'];
const verbsCancelar = ['desmarque', 'desmarcar', 'cancele', 'cancelar', 'cancela'];
const verbsAlterar  = ['altere', 'alterar', 'mude', 'muda', 'editar', 'edite', 'troque', 'troca'];

/* ---------- handler ---------- */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')  return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem } = req.body ?? {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  const txt = mensagem.toLowerCase();

  /* ----------- MARCAR ----------- */
  if (verbsMarcar.some(v => txt.includes(v))) {
    const dateISO = parseDateTime(txt);
    await supabase.from('appointments').insert({
      titulo: tituloCompromisso(txt),
      data_hora: dateISO,
      status: 'marcado',
    });
    const resp = dateISO
      ? `Compromisso "${tituloCompromisso(txt)}" marcado para ${new Date(dateISO).toLocaleString('pt-BR')}.`
      : `Compromisso "${tituloCompromisso(txt)}" criado (data/hora indefinidas).`;
    return res.json({ resposta: resp });
  }

  /* ----------- CANCELAR ----------- */
  if (verbsCancelar.some(v => txt.includes(v))) {
    const nome = tituloCompromisso(txt);
    await supabase
      .from('appointments')
      .update({ status: 'cancelado' })
      .eq('titulo', nome);
    return res.json({ resposta: `Compromisso "${nome}" cancelado.` });
  }

  /* ----------- ALTERAR ----------- */
  if (verbsAlterar.some(v => txt.includes(v))) {
    const nome = tituloCompromisso(txt);
    const dateISO = parseDateTime(txt);
    if (!dateISO) {
      return res.json({ resposta: 'Por favor informe nova data/hora.' });
    }
    await supabase
      .from('appointments')
      .update({ data_hora: dateISO, status: 'remarcado' })
      .eq('titulo', nome);
    return res.json({ resposta: `Compromisso "${nome}" remarcado para ${new Date(dateISO).toLocaleString('pt-BR')}.` });
  }

  /* ----------- LISTAR ----------- */
  const { data: rows } = await supabase
    .from('appointments')
    .select('*')
    .eq('status', 'marcado')
    .order('data_hora');

  if (!rows.length) return res.json({ resposta: 'Você não tem compromissos marcados.' });

  const lista = rows.map(r =>
    `• ${r.titulo} @ ${new Date(r.data_hora).toLocaleString('pt-BR')}`
  ).join('\n');

  return res.json({ resposta: `Lista de compromissos:\n${lista}` });
}
