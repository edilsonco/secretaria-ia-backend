import { createClient } from '@supabase/supabase-js';
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem, conversa_id = 'default' } = req.body;
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    // 1. Salvar mensagem do usuário
    await supabase.from('mensagens').insert({ conversa_id, papel: 'user', conteudo: mensagem });

    // 2. Buscar contexto (últimas 10 mensagens)
    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = historico.map(msg => ({ role: msg.papel, content: msg.conteudo }));
    contexto.unshift({ role: 'system', content: 'Você é uma secretária virtual...'});

    // 3. Ler compromissos
    const { data: compromissos } = await supabase
      .from('appointments')
      .select('*')
      .order('data_hora', { ascending: true });

    const lista = compromissos
      .filter(c => c.status === 'marcado')
      .map(c => `• ${c.titulo} @ ${dayjs(c.data_hora).format('DD/MM/YYYY, HH:mm')}`)
      .join('\n') || 'Nenhum compromisso marcado.';

    contexto.unshift({ role: 'system', content: `Agenda atual:\n${lista}` });

    // 4. Extrair intenção via OpenAI
    const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: 'gpt-4', temperature: 0, messages: contexto })
    });
    const { choices, error: aiErr } = await chatRes.json();
    if (chatRes.status !== 200) throw new Error(aiErr?.message || 'Erro na OpenAI');

    let resposta = choices[0].message.content.trim();

    // 5. Lógica de CRUD
    // Marcar novo
    if (/marque|agende|reserve/i.test(mensagem)) {
      const parsed = chrono.parseDate(mensagem, new Date(), { forwardDate: true });
      if (parsed) {
        const title = mensagem.replace(/.*?(?:reuni[oã]o|compromisso)\s+com\s+([\w\s]+)\s+.*/i, 'Reunião com $1');
        await supabase.from('appointments').insert({ titulo: title, data_hora: parsed });
        resposta = `Compromisso "${title}" marcado para ${dayjs(parsed).format('DD/MM/YYYY, HH:mm')}.`;
      }
    }
    // Listar
    else if (/quais|lista|mostre/i.test(mensagem)) {
      resposta = lista.includes('Nenhum')
        ? `Não há compromissos marcados para a data solicitada.`
        : `Agenda:\n${lista}`;
    }
    // Editar
    else if (/mude|altere|modifique/i.test(mensagem)) {
      const parsed = chrono.parseDate(mensagem, new Date(), { forwardDate: true });
      const match = mensagem.match(/(reuni[oã]o) com ([\w\s]+) para/i);
      if (parsed && match) {
        const who = match[2].trim();
        const { data: found } = await supabase
          .from('appointments')
          .select('id')
          .ilike('titulo', `%${who}%`)
          .eq('status', 'marcado');
        if (found.length) {
          await supabase
            .from('appointments')
            .update({ data_hora: parsed })
            .eq('id', found[0].id);
          resposta = `Compromisso "Reunião com ${who}" alterado para ${dayjs(parsed).format('DD/MM/YYYY, HH:mm')}.`;
        }
      }
    }
    // Desmarcar
    else if (/desmarque|cancele|remova/i.test(mensagem)) {
      const match = mensagem.match(/(reuni[oã]o) com ([\w\s]+)/i);
      if (match) {
        const who = match[2].trim();
        const { data: found } = await supabase
          .from('appointments')
          .select('id')
          .ilike('titulo', `%${who}%`)
          .eq('status', 'marcado');
        if (found.length) {
          await supabase
            .from('appointments')
            .update({ status: 'cancelado' })
            .eq('id', found[0].id);
          resposta = `Compromisso "Reunião com ${who}" cancelado.`;
        }
      }
    }

    // 6. Salvar resposta
    await supabase.from('mensagens').insert({ conversa_id, papel: 'assistant', conteudo: resposta });

    res.status(200).json({ resposta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
  }
}
