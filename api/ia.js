import { createClient } from '@supabase/supabase-js';
import chrono from 'chrono-node';
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
    // 1. Salvar mensagem do usuário na memória
    await supabase.from('mensagens').insert({ conversa_id, papel: 'user', conteudo: mensagem });

    // 2. Buscar histórico
    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(20);
    const contexto = historico.map(msg => ({ role: msg.papel, content: msg.conteudo }));

    // 3. Prompt de sistema
    contexto.unshift({
      role: 'system',
      content: 'Você é uma secretária virtual. Ajuda a marcar, alterar e desmarcar compromissos reais do usuário no banco de dados. Seja objetiva e só fale o que souber.'
    });

    // 4. Contexto de compromissos atuais
    const { data: compromissos } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });
    const lista = compromissos.length
      ? compromissos.map(c => `• ${c.titulo} em ${dayjs(c.data_hora).tz('America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm')}`).join('\n')
      : 'Nenhum compromisso marcado.';
    contexto.unshift({ role: 'system', content: `Compromissos atuais:\n${lista}` });

    // 5. Enviar para OpenAI
    const respostaIA = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: 'gpt-3.5-turbo', temperature: 0.5, messages: contexto })
    });
    const data = await respostaIA.json();
    if (respostaIA.status !== 200) throw new Error(JSON.stringify(data));
    const respostaTexto = data.choices[0].message.content;

    // 6. Salvar resposta na memória
    await supabase.from('mensagens').insert({ conversa_id, papel: 'assistant', conteudo: respostaTexto });

    // 7. Lógica de CRUD: marcar, desmarcar, alterar
    const lower = respostaTexto.toLowerCase();
    if (lower.includes('marcado') || lower.includes('agendado')) {
      // parse data/hora do texto original
      const dt = chrono.pt.parseDate(mensagem, new Date(), { forwardDate: true });
      const titulo = mensagem.replace(/.*reuni[oã]o/i, '').trim();
      await supabase.from('appointments').insert([{ titulo, data_hora: dt, status: 'marcado' }]);
    } else if (lower.match(/desmarc[ae]|cancelad/i)) {
      // extrai título ou nome
      // marca status = 'cancelado'
      const nome = (mensagem.match(/reuni[oã]o com ([^\s]+)/i) || [])[1];
      if (nome) {
        await supabase
          .from('appointments')
          .update({ status: 'cancelado' })
          .ilike('titulo', `%${nome}%`)
          .eq('status', 'marcado');
      }
    } else if (lower.match(/(alter|mud)/i)) {
      // extrair novo horário e atualizar
      const dt = chrono.pt.parseDate(mensagem, new Date(), { forwardDate: true });
      const nome = (mensagem.match(/reuni[oã]o com ([^\s]+)/i) || [])[1];
      if (nome && dt) {
        await supabase
          .from('appointments')
          .update({ data_hora: dt })
          .ilike('titulo', `%${nome}%`)
          .eq('status', 'marcado');
      }
    }

    // Responder
    res.status(200).json({ resposta: respostaTexto });
  } catch (error) {
    console.error('Erro interno:', error);
    res.status(500).json({ erro: 'Erro interno no servidor', detalhes: error.message });
  }
}
