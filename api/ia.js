// api/ia.js
import { createClient } from '@supabase/supabase-js';
import { Configuration, OpenAIApi } from 'openai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

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
    return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem, conversa_id = 'default' } = req.body;
  if (!mensagem)
    return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    // 1) grava usuário
    await supabase
      .from('mensagens')
      .insert({ conversa_id, papel: 'user', conteudo: mensagem });

    // 2) histórico (últimas 10)
    const { data: hist } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = hist.map((m) => ({
      role: m.papel,
      content: m.conteudo
    }));
    contexto.unshift({
      role: 'system',
      content:
        'Você é uma secretária virtual. Marque, liste, altere e desmarque compromissos reais do usuário.'
    });

    // 3) lista atual de compromissos
    const { data: comps } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    const lista =
      comps
        .map(
          (c) =>
            `• ${c.titulo} @ ${dayjs(c.data_hora)
              .utc()
              .format('DD/MM/YYYY HH:mm')}`
        )
        .join('\n') || 'Nenhum compromisso marcado.';
    contexto.unshift({ role: 'system', content: `Agenda atual:\n${lista}` });

    // 4) chama OpenAI
    const aiRes = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      temperature: 0.5,
      messages: contexto
    });
    const respostaTexto = aiRes.data.choices[0].message.content;

    // 5) grava resposta
    await supabase
      .from('mensagens')
      .insert({ conversa_id, papel: 'assistant', conteudo: respostaTexto });

    // 6) lógica de ação
    const txt = respostaTexto.toLowerCase();

    // Função auxiliar para extrair horário
    function parseHora(text) {
      const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*h/);
      if (!m) return null;
      const hh = parseInt(m[1], 10);
      const mm = m[2] ? parseInt(m[2], 10) : 0;
      return { hh, mm };
    }

    // Detecta "amanhã"
    const isTomorrow = /amanh/i.test(mensagem);

    // 6.1) MARCAR
    if (/(marc|agend).*reunião/i.test(txt)) {
      let when;
      const hora = parseHora(mensagem);
      if (isTomorrow && hora) {
        when = dayjs()
          .add(1, 'day')
          .hour(hora.hh)
          .minute(hora.mm)
          .second(0)
          .toDate();
      } else {
        // fallback: data absoluta
        when = chrono
          .parseDate(mensagem, new Date(), { forwardDate: true });
      }
      if (when) {
        await supabase.from('appointments').insert({
          titulo: mensagem.replace(/marque\s*/i, ''),
          data_hora: when
        });
      }
    }

    // 6.2) DESMARCAR / CANCELAR
    if (/desmarc|cancel/i.test(txt)) {
      const nome = (mensagem.match(/reunião com\s+(\w+)/i) || [])[1] || '';
      await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .ilike('titulo', `%${nome}%`);
    }

    // 6.3) ALTERAR
    if (/muda|altera/i.test(txt)) {
      let when;
      const hora = parseHora(mensagem);
      if (isTomorrow && hora) {
        when = dayjs()
          .add(1, 'day')
          .hour(hora.hh)
          .minute(hora.mm)
          .second(0)
          .toDate();
      } else {
        when = chrono.parseDate(mensagem, new Date(), { forwardDate: true });
      }
      const nome = (mensagem.match(/reunião com\s+(\w+)/i) || [])[1] || '';
      if (when) {
        await supabase
          .from('appointments')
          .update({ data_hora: when })
          .ilike('titulo', `%${nome}%`);
      }
    }

    return res.status(200).json({ resposta: respostaTexto });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
  }
}
