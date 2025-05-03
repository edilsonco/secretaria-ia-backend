import { createClient } from '@supabase/supabase-js';
import { Configuration, OpenAIApi } from 'openai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import chrono from 'chrono-node';

dayjs.extend(utc);

// --- 1. Clientes
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem, conversa_id = 'default' } = req.body;
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    // --- 2. Memória: salva pergunta do usuário
    await supabase.from('mensagens').insert({ conversa_id, papel: 'user', conteudo: mensagem });

    // --- 3. Monta contexto com últimas 10 mensagens
    const { data: hist } = await supabase
      .from('mensagens')
      .select('papel,conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = hist.map(m => ({
      role:   m.papel === 'assistant' ? 'assistant' : 'user',
      content: m.conteudo
    }));

    // --- 4. Põe o prompt do sistema + lista atual de compromissos
    contexto.unshift({
      role: 'system',
      content:
        'Você é uma secretária virtual. Marca, lista, altera e desmarca compromissos reais no banco de dados.'
    });

    const { data: ag } = await supabase
      .from('appointments')
      .select('titulo,data_hora,status')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    const lista =
      ag.length === 0
        ? 'Nenhum compromisso marcado.'
        : ag.map(a => `• ${a.titulo} em ${dayjs(a.data_hora).format('DD/MM/YYYY HH:mm')}`).join('\n');

    contexto.unshift({
      role: 'system',
      content: `Agenda atual:\n${lista}`
    });

    // --- 5. Chama a OpenAI
    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      temperature: 0.5,
      messages: contexto
    });

    const respostaTexto = completion.data.choices[0].message.content.trim();

    // --- 6. Salva resposta da IA na memória
    await supabase.from('mensagens').insert({
      conversa_id,
      papel: 'assistant',
      conteudo: respostaTexto
    });

    // --- 7. CRUD básico
    const txt = mensagem.toLowerCase();

    // a) MARCAR
    if (txt.match(/\b(marque|agende)\b/)) {
      const dt = chrono.parseDate(mensagem, new Date(), { forwardDate: true });
      await supabase.from('appointments').insert({
        titulo: mensagem,              // aqui você pode extrair só o título
        data_hora: dayjs(dt).utc().toISOString(),
        status: 'marcado'
      });
    }

    // b) DESMARCAR
    else if (txt.match(/\b(desmarque|cancele|remova)\b/)) {
      // remove todos os marcados cujo título contenha o nome
      await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .ilike('titulo', `%${mensagem.replace(/.*reuni[oã]o\s*/, '')}%`)
        .eq('status', 'marcado');
    }

    // c) ALTERAR
    else if (txt.match(/\b(mude|altere|ajuste)\b/)) {
      const dt = chrono.parseDate(mensagem, new Date(), { forwardDate: true });
      // aqui você precisaria identificar qual registro alterar—
      // colocamos um exemplo genérico onde o usuário menciona “com X”
      const quem = mensagem.match(/com\s+([A-Za-zÀ-ú]+)/i)?.[1] || '';
      await supabase
        .from('appointments')
        .update({ data_hora: dayjs(dt).utc().toISOString() })
        .ilike('titulo', `%${quem}%`)
        .eq('status', 'marcado');
    }

    // --- 8. Retorna pra UI
    res.status(200).json({ resposta: respostaTexto });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
  }
}
