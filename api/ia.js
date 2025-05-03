import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dayjs from 'dayjs';
import utc from 'dayjs-plugin-utc.js';
import chrono from 'chrono-node';

dayjs.extend(utc);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// util — converte “amanhã às 18h” etc.
function parseDate(str) {
  const ref = dayjs().toDate();
  const results = chrono.pt.parse(str, ref);
  if (!results.length) return null;
  return dayjs(results[0].start.date()).utc();        // UTC p/ armazenar
}

// salva mensagem de chat (memória curta)
async function remember(conversa_id, papel, conteudo) {
  await supabase.from('mensagens').insert({ conversa_id, papel, conteudo });
}

// busca compromissos ativos entre 0 h e 23 h da data pedida
async function compromissosDoDia(d) {
  const ini = d.utc().startOf('day').toISOString();
  const fim = d.utc().endOf('day').toISOString();
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('status', 'marcado')
    .gte('data_hora', ini)
    .lte('data_hora', fim)
    .order('data_hora');
  return data;
}

export default async function handler(req, res) {
  // CORS simples
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem, conversa_id = 'default' } = req.body ?? {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  // passo 1 – salva pergunta
  await remember(conversa_id, 'user', mensagem);

  /* ===============================================================
     INTENT DETECTION SIMPLES (regex)
     =============================================================== */
  const low = mensagem.toLowerCase();

  // MARCAR
  if (/^marque\b|\bagende\b|\bmarcar\b/.test(low)) {
    const data = parseDate(mensagem);
    if (!data) {
      return res.json({ resposta: 'Desculpe, não consegui entender a data/hora.' });
    }
    const titulo = mensagem.replace(/marque\b|\bagende\b/gi, '').trim();

    await supabase.from('appointments').insert({
      titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1),
      data_hora: data.toISOString()
    });

    const resposta = `Compromisso "${titulo}" marcado para ${data.local().format('DD/MM/YYYY, HH:mm')}.";

    await remember(conversa_id, 'assistant', resposta);
    return res.json({ resposta });
  }

  // LISTAR
  if (/quais.*compromissos.*amanh[ãa]/i.test(mensagem) || /tenho.*compromisso.*amanh[ãa]/i.test(mensagem)) {
    const data = dayjs().add(1, 'day');
    const list = await compromissosDoDia(data);
    const resposta =
      list.length === 0
        ? 'Você não tem compromissos agendados para amanhã.'
        : 'Compromissos de amanhã:\n' +
          list.map(c => `• ${c.titulo} às ${dayjs(c.data_hora).local().format('HH:mm')}`).join('\n');
    await remember(conversa_id, 'assistant', resposta);
    return res.json({ resposta });
  }

  // ALTERAR
  if (/muda\b|alter(e|a)\b|remarque\b/i.test(mensagem)) {
    const tituloMatch = mensagem.match(/reuni[aã]o(?: com)? ([\p{L}\s]+?) (?:para|pras|às?)/iu);
    if (!tituloMatch) {
      return res.json({ resposta: 'Por favor, informe o título/nome do compromisso e a nova data/hora.' });
    }
    const novoHorario = parseDate(mensagem);
    if (!novoHorario) {
      return res.json({ resposta: 'Por favor, informe a nova data/hora em formato compreensível.' });
    }
    const nome = `Reunião com ${tituloMatch[1].trim()}`;

    const { data: comp } = await supabase
      .from('appointments')
      .select('*')
      .ilike('titulo', `%${nome}%`)
      .eq('status', 'marcado')
      .limit(1)
      .maybeSingle();

    if (!comp) {
      return res.json({ resposta: `Não encontrei compromisso "${nome}" para alterar.` });
    }
    await supabase
      .from('appointments')
      .update({ data_hora: novoHorario.toISOString() })
      .eq('id', comp.id);

    const resposta = `Compromisso "${nome}" remarcado para ${novoHorario.local().format('DD/MM/YYYY, HH:mm')}.`;
    await remember(conversa_id, 'assistant', resposta);
    return res.json({ resposta });
  }

  // DESMARCAR
  if (/desmarc|cancel/i.test(mensagem)) {
    const match = mensagem.match(/reuni[aã]o(?: com)? ([\p{L}\s]+)/iu);
    if (!match) {
      return res.json({ resposta: 'Indique qual compromisso deseja desmarcar.' });
    }
    const nome = `Reunião com ${match[1].trim()}`;
    const { data: comp } = await supabase
      .from('appointments')
      .select('*')
      .ilike('titulo', `%${nome}%`)
      .eq('status', 'marcado')
      .limit(1)
      .maybeSingle();

    if (!comp) {
      return res.json({ resposta: `Não encontrei "${nome}" para desmarcar.` });
    }
    await supabase
      .from('appointments')
      .update({ status: 'cancelado' })
      .eq('id', comp.id);

    const resposta = `Compromisso "${nome}" cancelado.`;
    await remember(conversa_id, 'assistant', resposta);
    return res.json({ resposta });
  }

  /* ---------------------------------------------------------------
     Se nenhuma regra capturou, cai no fallback OpenAI
     --------------------------------------------------------------- */
  const fallback = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'Você é uma secretária virtual.' },
      { role: 'user', content: mensagem }
    ],
    temperature: 0.5
  });
  const resposta = fallback.choices[0].message.content.trim();
  await remember(conversa_id, 'assistant', resposta);
  return res.json({ resposta });
}
