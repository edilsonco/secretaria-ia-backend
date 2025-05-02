/* api/ia.js — secretaria-ia-backend  */
/* eslint-disable no-console */
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

/* --- 1.  SDKs ------------------------------------------------------------ */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,            // variável já criada na Vercel
});
const supabase = createClient(
  process.env.SUPABASE_URL,                      // variável já criada na Vercel
  process.env.SUPABASE_SERVICE_ROLE_KEY          // variável já criada na Vercel
);

/* --- 2.  Utilidades simples --------------------------------------------- */

/* Expressões para detectar rapidamente o que o usuário quer                      */
const criarRegex   = /\b(marcar?|marque|agendar?|agende|agenda|reserve?)\b.*\b(reuni[aã]o|encontro|call|compromisso)\b/i;
const cancelarRegex = /\b(desmarcar?|cancela[rs]?|remover?|excluir?)\b.*\b(reuni[aã]o|compromisso)\b/i;
const alterarRegex  = /\b(alt[ea]r?|muda[rs]?|edi[tc]?)\b.*\b(reuni[aã]o|compromisso)\b/i;

/* Extrai data e hora em  2025-05-05 14:00  ou  05/05/2025 14h  */
function extrairDataHora(texto) {
  const m =
    texto.match(/(\d{4}-\d{2}-\d{2})\s*(?:às|as)?\s*(\d{2})(?::(\d{2}))?/) ||
    texto.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:às|as)?\s*(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [dia, mes, ano] = m[1].includes('-')
    ? m[1].split('-').map(Number)          // YYYY-MM-DD
    : m[1].split('/').reverse().map(Number); // DD/MM/YYYY
  const hora = Number(m[2]);
  const minuto = m[3] ? Number(m[3]) : 0;
  return new Date(ano, mes - 1, dia, hora, minuto).toISOString();
}

/* --- 3.  Handler --------------------------------------------------------- */
export default async function handler(req, res) {
  /* CORS simplificado */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem } = req.body || {};
  if (!mensagem) return res.status(400).json({ erro: 'Campo "mensagem" obrigatório' });

  /* --- 3.1  Agenda atual (string) --------------------------------------- */
  const { data: ag } = await supabase.from('appointments').select('*').eq('status', 'marcado').order('data_hora');
  const lista = (ag ?? []).map((c) => `• ${c.titulo} em ${new Date(c.data_hora).toLocaleString('pt-BR')}`).join('\n') || 'Nenhum compromisso.';

  /* --- 3.2  Monta mensagens para o modelo ------------------------------- */
  const mensagens = [
    {
      role: 'system',
      content: `Você é uma secretária virtual. Seja objetiva. 
Agenda do usuário agora:\n${lista}`,
    },
    { role: 'user', content: mensagem },
  ];

  /* --- 3.3  Especificamos a função que o GPT pode chamar ---------------- */
  const fnCriar = {
    name: 'criar_compromisso',
    description: 'Cria um compromisso real na agenda do usuário',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Descrição curta' },
        data_hora: { type: 'string', description: 'Data/hora em ISO-8601' },
      },
      required: ['titulo', 'data_hora'],
    },
  };

  /* --- 3.4  Envia para OpenAI ------------------------------------------ */
  const resposta = await openai.chat.completions.create({
    model: 'gpt-4o-mini',                 // usa modelo atual
    temperature: 0.4,
    messages: mensagens,
    functions: [fnCriar],
    function_call: 'auto',                // deixa o modelo decidir
  });

  const escolha = resposta.choices[0];

  /* --- 3.5  Se o modelo pediu para EXECUTAR a função -------------------- */
  if (escolha.finish_reason === 'function_call' && escolha.message.function_call) {
    const { name, arguments: argsJSON } = escolha.message.function_call;
    if (name === 'criar_compromisso') {
      /* Parseia JSON seguro                          */
      let args;
      try { args = JSON.parse(argsJSON); } catch { args = {}; }

      /* Se o modelo não extraiu, tenta regex manual */
      if (!args.titulo)     args.titulo = mensagem;
      if (!args.data_hora)  args.data_hora = extrairDataHora(mensagem);

      if (!args.data_hora) {
        return res.status(400).json({ resposta: 'Desculpe, não consegui entender a data/hora.' });
      }

      /* Insere no Supabase                                       */
      await supabase.from('appointments').insert({
        titulo: args.titulo,
        data_hora: args.data_hora,
        status: 'marcado',
      });

      const textoOk = `Compromisso "${args.titulo}" marcado para ${new Date(args.data_hora).toLocaleString('pt-BR')}.`;
      return res.status(200).json({ resposta: textoOk });
    }
  }

  /* --- 3.6  Caso comum: só devolver o texto da IA ---------------------- */
  return res.status(200).json({ resposta: escolha.message.content });
}
