// api/ia.js  (ESM)
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
dayjs.extend(customParseFormat);

// ------------------------------------------------------------------
// 1) instâncias
// ------------------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ------------------------------------------------------------------
// 2) utilitários
// ------------------------------------------------------------------
const PT_BR = {
  months:      ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'],
  weekdays:    ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'],
};
function formatarDataHora(d) {
  return dayjs(d).format('DD/MM/YYYY HH:mm');
}

// converte “amanhã”, “hoje”, “depois de amanhã” → data ISO
function interpretarData(texto) {
  const hoje = dayjs().startOf('day');
  if (/amanh[aã]/i.test(texto))             return hoje.add(1, 'day');
  if (/depois de amanh[aã]/i.test(texto))   return hoje.add(2, 'day');
  if (/hoje/i.test(texto))                  return hoje;
  // tenta formatos explícitos (05/05/2025 ou 2025-05-05)
  const exp = /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/;
  const iso = /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/;
  if (exp.test(texto)) {
    const [, d,m,y] = texto.match(exp);
    return dayjs(`${y}-${m}-${d}`, 'YYYY-MM-DD');
  }
  if (iso.test(texto)) {
    const [, y,m,d] = texto.match(iso);
    return dayjs(`${y}-${m}-${d}`, 'YYYY-MM-DD');
  }
  return null; // não entendeu
}

function interpretarHora(texto) {
  // aceita 19h, 19:00, 19 horas
  const m = texto.match(/(\d{1,2})(?::(\d{2}))?\s?(h|horas)?/i);
  if (!m) return null;
  const hora = m[1].padStart(2,'0');
  const min  = m[2] ? m[2] : '00';
  return `${hora}:${min}`;
}

// ------------------------------------------------------------------
// 3) handler
// ------------------------------------------------------------------
export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({erro:'Método não permitido'});

  // --- input ---
  const { mensagem } = req.body ?? {};
  if (!mensagem) return res.status(400).json({erro:'Campo "mensagem" é obrigatório.'});

  try {
    // ----------------------------------------------------------------
    // 3.1) carrega compromissos existentes
    // ----------------------------------------------------------------
    const { data: compromissos } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    // string para o sistema
    const listaSistema =
      compromissos.length === 0
        ? 'Nenhum compromisso marcado.'
        : compromissos.map(c =>
            `• ${c.titulo} @ ${formatarDataHora(c.data_hora)}`).join('\n');

    // ----------------------------------------------------------------
    // 3.2) prompt & few-shot
    // ----------------------------------------------------------------
    const mensagemSistema =
      `Você é uma secretária virtual brasileira. ` +
      `Sua tarefa é MARCAR, DESMARCAR ou ALTERAR compromissos do usuário ` +
      `em um banco PostgreSQL (já abstraído por funções).\n\n` +
      `Formato de resposta: apenas a frase final para o usuário, sem markdown.\n\n` +
      `Compromissos atuais:\n${listaSistema}`;

    const messages = [
      { role:'system', content: mensagemSistema },
      { role:'user',   content: mensagem },
    ];

    // ----------------------------------------------------------------
    // 3.3) pergunta ao GPT-4o
    // ----------------------------------------------------------------
    const chat = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.3,
    });
    const respostaIA = chat.choices[0].message.content.trim();

    // ----------------------------------------------------------------
    // 3.4) processamento local: tenta identificar intenção (regex simples)
    // ----------------------------------------------------------------
    const lower = mensagem.toLowerCase();

    // --- desmarcar ---------------------------------------------------
    if (/desmarc|cancel/i.test(lower)) {
      const { data: _ } = await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .ilike('titulo', `%${lower.split('com')[1] ?? ''}%`);
    }

    // --- alterar -----------------------------------------------------
    if (/muda|altera|remarc/i.test(lower)) {
      const novaHora = interpretarHora(mensagem);
      const novaData = interpretarData(mensagem);
      if (novaHora && novaData) {
        const dt = `${novaData.format('YYYY-MM-DD')} ${novaHora}`;
        await supabase
          .from('appointments')
          .update({ data_hora: dt })
          .ilike('titulo', `%${lower.split('com')[1] ?? ''}%`);
      }
    }

    // --- marcar ------------------------------------------------------
    if (/marque|marca|agend/i.test(lower)) {
      const hora = interpretarHora(mensagem);
      const data = interpretarData(mensagem) || dayjs().add(1, 'day'); // amanhã padrão
      if (hora) {
        const dt = `${data.format('YYYY-MM-DD')} ${hora}`;
        const titulo = mensagem.replace(/(marque|marca|agende|amanhã|hoje).*/i,'').trim();
        await supabase.from('appointments').insert({
          titulo: titulo || 'Compromisso',
          data_hora: dt,
          status: 'marcado',
        });
      }
    }

    // ----------------------------------------------------------------
    // 3.5) devolve resposta do chat
    // ----------------------------------------------------------------
    return res.status(200).json({ resposta: respostaIA });

  } catch (err) {
    console.error(err);
    return res.status(500).json({erro:'Erro interno', detalhes:err.message});
  }
}
