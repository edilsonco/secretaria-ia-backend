import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/* ---------- 1. clientes ---------- */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ---------- 2. handler ---------- */
export default async function handler(req, res) {
  /* CORS */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  /* ---------- 2.1 validar corpo ---------- */
  const { mensagem, conversa_id = 'default' } = req.body || {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    /* ---------- 3. gravar mensagem do usuário ---------- */
    await supabase.from('mensagens').insert({
      conversa_id,
      papel: 'user',
      conteudo: mensagem
    });

    /* ---------- 4. obter histórico ---------- */
    const { data: hist } = await supabase
      .from('mensagens')
      .select('papel,conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(12);

    const contexto = hist.map(m => ({ role: m.papel, content: m.conteudo }));

    /* ---------- 5. snapshot de compromissos ---------- */
    const { data: compromissos } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    const lista = compromissos.length
      ? compromissos.map(c => `• ${c.titulo} @ ${new Date(c.data_hora).toLocaleString('pt-BR')}`).join('\n')
      : 'Nenhum compromisso marcado.';

    contexto.unshift({
      role: 'system',
      content: `Lista atual de compromissos do usuário:\n${lista}`
    });

    contexto.unshift({
      role: 'system',
      content:
        'Você é uma secretária virtual. Marque, desmarque ou altere compromissos no banco. ' +
        'Responda apenas o necessário. Se algo não existir, informe. Formato PT-BR.'
    });

    /* ---------- 6. enviar para OpenAI ---------- */
    const respIA = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      temperature: 0.3,
      messages: contexto
    });

    const resposta = respIA.choices[0].message.content.trim();

    /* ---------- 7. salvar resposta ---------- */
    await supabase.from('mensagens').insert({
      conversa_id,
      papel: 'assistant',
      conteudo: resposta
    });

    /* ---------- 8. regex simples p/ AÇÃO ---------- */
    const regexMarcar   = /marcado para (\d{2}\/\d{2}\/\d{4})[ ,]+(\d{2}:\d{2})/i;
    const regexDesmar   = /compromisso .*? (?:removido|desmarcado)/i;
    const regexAlterado = /alterado.*?para (\d{2}\/\d{2}\/\d{4})[ ,]+(\d{2}:\d{2})/i;

    if (regexMarcar.test(resposta)) {
      const [, d, h] = resposta.match(regexMarcar);
      await supabase.from('appointments').insert({
        titulo: resposta.split('"')[1] || 'compromisso',
        data_hora: `${d.split('/').reverse().join('-')}T${h}:00`,
        status: 'marcado'
      });
    } else if (regexDesmar.test(resposta)) {
      /* seta status = cancelado no mais recente */
      const { data: ult } = await supabase
        .from('appointments')
        .select('id')
        .eq('status', 'marcado')
        .order('created_at', { ascending: false })
        .limit(1);
      if (ult[0]) {
        await supabase.from('appointments')
          .update({ status: 'cancelado' })
          .eq('id', ult[0].id);
      }
    } else if (regexAlterado.test(resposta)) {
      const [, d, h] = resposta.match(regexAlterado);
      const { data: ult } = await supabase
        .from('appointments')
        .select('id')
        .eq('status', 'marcado')
        .order('created_at', { ascending: false })
        .limit(1);
      if (ult[0]) {
        await supabase.from('appointments')
          .update({ data_hora: `${d.split('/').reverse().join('-')}T${h}:00` })
          .eq('id', ult[0].id);
      }
    }

    return res.status(200).json({ resposta });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: 'Falha interna', detalhes: err.message });
  }
}
