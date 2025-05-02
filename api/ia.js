import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------- utilidades ---------- */
function extrairDataHora(texto) {
  // Aceita “2025-05-05 às 17:00”, “05/05/2025 17h” ou “05/05 às 17h”
  const regex =
    /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?)\D{1,10}(\d{1,2}:\d{2}|\d{1,2}h)/i;
  const m = texto.match(regex);
  if (!m) return null;

  let [data, hora] = [m[1], m[2]];
  // Normaliza data para YYYY-MM-DD
  if (data.includes('/')) {
    const [d, mes, a] = data.split('/');
    data = `${a || new Date().getFullYear()}-${mes.padStart(2, '0')}-${d.padStart(
      2,
      '0'
    )}`;
  }
  // Normaliza hora para HH:MM
  if (hora.endsWith('h')) hora = hora.replace('h', ':00');
  if (/^\d{1}:\d{2}$/.test(hora)) hora = '0' + hora;

  return `${data} ${hora}`;
}

async function salvarMensagem(conversa_id, papel, conteudo) {
  await supabase
    .from('mensagens')
    .insert({ conversa_id, papel, conteudo })
    .select();
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem, conversa_id = 'default' } = req.body || {};
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    /* 1. salva mensagem do usuário  */
    await salvarMensagem(conversa_id, 'user', mensagem);

    /* 2. busca último histórico (máx 15)  */
    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(15);

    const contexto = historico.map((m) => ({
      role: m.papel,
      content: m.conteudo,
    }));

    /* 3. pega lista de compromissos marcados  */
    const { data: compromissos } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    const lista =
      compromissos.length === 0
        ? 'Nenhum compromisso marcado.'
        : compromissos
            .map(
              (c) =>
                `• ${c.titulo} @ ${new Date(c.data_hora).toLocaleString('pt-BR')}`
            )
            .join('\n');

    contexto.unshift({
      role: 'system',
      content:
        'Você é uma secretária virtual. Utilize a lista de compromissos abaixo para responder com máxima precisão. ' +
        'Quando marcar um novo compromisso, use a frase “Compromisso «Título» marcado para DD/MM/YYYY HH:MM.” ' +
        'Quando desmarcar, use “Compromisso «Título» cancelado”. Quando alterar, use “Compromisso «Título» alterado para …”.',
    });
    contexto.unshift({ role: 'system', content: `Lista atual de compromissos:\n${lista}` });

    /* 4. envia à OpenAI (modelo atualizado)  */
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      temperature: 0.4,
      messages: contexto,
    });
    const resposta = completion.choices[0].message.content.trim();

    /* 5. grava resposta da IA  */
    await salvarMensagem(conversa_id, 'assistant', resposta);

    /* 6. tentativa de interpretar manualmente (fallback) -------- */
    // Caso a OpenAI ainda não tenha feito, tentamos parsear e gravar
    if (/marque/i.test(mensagem)) {
      const dh = extrairDataHora(mensagem);
      if (dh) {
        await supabase.from('appointments').insert({
          titulo: mensagem.replace(/marque/i, '').trim(),
          data_hora: dh,
          status: 'marcado',
        });
      }
    } else if (/(desmarc|cancel)/i.test(mensagem)) {
      await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .like('titulo', `%${mensagem.split('com')[1] || ''}%`);
    } else if (/(alter|muda)/i.test(mensagem)) {
      const dh = extrairDataHora(mensagem);
      if (dh) {
        await supabase
          .from('appointments')
          .update({ data_hora: dh })
          .like('titulo', `%${mensagem.split('com')[1] || ''}%`);
      }
    }

    return res.status(200).json({ resposta });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Falha interna', detalhes: e.message });
  }
}
