// api/ia.js
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// ---------- 1. Instâncias ----------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------- 2. Handler ----------
export default async function handler(req, res) {
  // ——— CORS ———
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // ——— Entrada ———
  const { mensagem, conversa_id = 'default' } = req.body || {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    // 3. Salvar mensagem do usuário
    await supabase.from('mensagens').insert({ conversa_id, papel: 'user', conteudo: mensagem });

    // 4. Trazer histórico (últimas 20)
    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(20);

    const contexto = historico.map(m => ({ role: m.papel, content: m.conteudo }));

    // 5. Adicionar contexto de compromissos
    const { data: compromissos } = await supabase
      .from('appointments')
      .select('titulo, data_hora, status')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    const lista = compromissos.length
      ? compromissos.map(c => `• ${c.titulo} em ${new Date(c.data_hora).toLocaleString()}`).join('\n')
      : 'Nenhum compromisso marcado.';

    contexto.unshift({
      role: 'system',
      content: `Você é uma secretária virtual. A lista atual de compromissos do usuário é:\n${lista}`
    });

    // 6. Chamada à OpenAI  (***modelo corrigido***)
    const chat = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',          // <<<<  aqui está a mudança
      temperature: 0.4,
      messages: contexto
    });

    const resposta = chat.choices[0].message.content;

    // 7. Salvar resposta da IA
    await supabase.from('mensagens').insert({ conversa_id, papel: 'assistant', conteudo: resposta });

    // 8. Regras simples de gravação/alteração/desmarque (exemplo)
    if (/marquei|agendei/.test(resposta.toLowerCase())) {
      await supabase.from('appointments').insert({
        titulo: mensagem,
        data_hora: new Date(),     // simplificado; ideal: extrair data/hora da IA
        status: 'marcado'
      });
    } else if (/desmarquei|cancelado/.test(resposta.toLowerCase())) {
      await supabase.from('appointments')
        .update({ status: 'cancelado' })
        .like('titulo', `%${mensagem}%`);
    } else if (/alterei|atualizei/.test(resposta.toLowerCase())) {
      // lógica de update (exemplo mínimo)
      await supabase.from('appointments')
        .update({ data_hora: new Date() })
        .like('titulo', `%${mensagem}%`);
    }

    // 9. Resposta ao front-end
    return res.status(200).json({ resposta });
  } catch (err) {
    console.error('Erro geral:', err);
    return res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
  }
}
