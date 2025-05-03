import { createClient } from '@supabase/supabase-js';
import { Configuration, OpenAIApi } from 'openai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import chrono from 'chrono-node';

dayjs.extend(utc);
dayjs.extend(timezone);
// usa a variável que você salvou no Vercel
const TZ = process.env.APP_TIMEZONE || 'UTC';
dayjs.tz.setDefault(TZ);

// inicializa Supabase e OpenAI
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const { mensagem, conversa_id = 'default' } = req.body;
  if (!mensagem) return res.status(400).json({ error: 'Mensagem não fornecida' });

  try {
    // 1) Salva na memória
    await supabase
      .from('mensagens')
      .insert({ conversa_id, papel: 'user', conteudo: mensagem });

    // 2) Busca últimas 10 mensagens
    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = historico.map((m) => ({
      role: m.papel === 'user' ? 'user' : 'assistant',
      content: m.conteudo,
    }));

    // 3) Prompt de sistema
    contexto.unshift({
      role: 'system',
      content:
        'Você é uma secretária virtual. Sua função é ajudar a marcar, listar, alterar e desmarcar compromissos reais do usuário, armazenados em um banco de dados. Seja clara e objetiva.',
    });

    // 4) Lista de compromissos atuais (status = marcado)
    const { data: compromissos } = await supabase
      .from('appointments')
      .select('id, titulo, data_hora, status')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    const lista = compromissos.length
      ? compromissos
          .map(
            (c) =>
              `• "${c.titulo}" em ${dayjs(c.data_hora)
                .tz(TZ)
                .format('DD/MM/YYYY [às] HH:mm')}`
          )
          .join('\n')
      : 'Nenhum compromisso marcado.';

    contexto.unshift({
      role: 'system',
      content: `Agenda atual:\n${lista}`,
    });

    // 5) Envia ao OpenAI
    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      temperature: 0.5,
      messages: contexto,
    });

    const respostaTexto = completion.data.choices[0].message.content;

    // 6) Salva resposta na memória
    await supabase
      .from('mensagens')
      .insert({ conversa_id, papel: 'assistant', conteudo: respostaTexto });

    // 7) Lógica básica de CRUD:
    const lower = respostaTexto.toLowerCase();
    // MARCAR
    if (lower.includes('marcada') || lower.includes('marcado')) {
      // extrai data/hora original com chrono
      const dt = chrono
        .parseDate(mensagem, new Date(), { timezone: TZ })
        .toISOString();
      await supabase.from('appointments').insert({
        titulo: mensagem, // você pode ajustar para extrair só o título
        data_hora: dt,
        status: 'marcado',
      });
    }
    // DESMARCAR
    if (lower.includes('desmarcada') || lower.includes('cancelado')) {
      // aqui você precisaria identificar qual compromisso — exemplo genérico:
      const titulo = mensagem.match(/reunião com (.+?)( |$)/i)?.[1];
      await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .ilike('titulo', `%${titulo}%`)
        .eq('status', 'marcado');
    }
    // (futuramente) ALTERAR — mesma ideia, só que update(data_hora)

    return res.status(200).json({ resposta: respostaTexto });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
}
