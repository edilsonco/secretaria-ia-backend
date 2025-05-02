// api/ia.js
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';                     // ← depende do pacote openai@4

/* ──────────────── 1. clients ──────────────── */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ──────────────── 2. handler ──────────────── */
export default async function handler(req, res) {
  /* CORS pré-flight */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ erro: 'Método não permitido' });

  /* Entrada */
  const { mensagem, conversa_id = 'default' } = req.body || {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    /* 1. grava a mensagem do usuário */
    await supabase.from('mensagens')
      .insert({ conversa_id, papel: 'user', conteudo: mensagem });

    /* 2. busca últimas 10 mensagens (memória) */
    const { data: historico = [] } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = historico.map(m => ({ role: m.papel, content: m.conteudo }));

    /* 3. lista atual de compromissos */
    const { data: compromissos = [] } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    const lista = compromissos.length
      ? compromissos.map(c => `• ${c.titulo} em ${new Date(c.data_hora).toLocaleString('pt-BR')}`).join('\n')
      : 'Nenhum compromisso marcado.';

    /* 4. prompt de sistema + few-shot */
    contexto.unshift(
      {
        role: 'system',
        content: [
          'Você é uma secretária virtual:',
          '• Interprete instruções em português (marcar, desmarcar, alterar).',
          '• Responda sempre no formato: “✅ <ação>” ou “ℹ️ <info>”.',
          '• Use as palavras-chave EXATAS: MARQUEI, DESMARQUEI, ALTEREI.',
          '• Se não conseguir, responda “❓ Não entendi, poderia reformular?”.',
          `• Agenda atual:\n${lista}`
        ].join('\n')
      },
      { role: 'user',      content: 'Marque reunião amanhã às 9h com a Tati' },
      { role: 'assistant', content: '✅ MARQUEI reunião amanhã às 09:00 com Tati.' },
      { role: 'user',      content: 'Desmarque a reunião com a Tati' },
      { role: 'assistant', content: '✅ DESMARQUEI reunião com Tati.' }
    );

    /* 5. chama OpenAI (modelo estável) */
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',          // modelo ainda disponível
      temperature: 0.5,
      messages: contexto
    });

    const resposta = completion.choices[0].message.content.trim();

    /* 6. grava resposta na memória */
    await supabase.from('mensagens')
      .insert({ conversa_id, papel: 'assistant', conteudo: resposta });

    /* 7. ações no banco pelo texto-chave */
    const lower = resposta.toLowerCase();

    if (lower.includes('marquei')) {
      // tentar extrair informações simples (placeholder)
      await supabase.from('appointments')
        .insert({ titulo: mensagem, data_hora: new Date(), status: 'marcado' });
    }
    else if (lower.includes('desmarquei')) {
      await supabase.from('appointments')
        .update({ status: 'cancelado' })
        .match({ status: 'marcado' })          // critério simplificado
        .order('created_at', { ascending: false })
        .limit(1);
    }
    else if (lower.includes('alterei')) {
      await supabase.from('appointments')
        .update({ data_hora: new Date() })     // placeholder
        .match({ status: 'marcado' })
        .order('created_at', { ascending: false })
        .limit(1);
    }

    return res.status(200).json({ resposta });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
  }
}
