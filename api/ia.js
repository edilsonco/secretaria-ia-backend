import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { mensagem } = req.body;

  if (!mensagem) {
    return res.status(400).json({ erro: 'Mensagem não fornecida.' });
  }

  try {
    const respostaIA = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        temperature: 0.5,
        messages: [
          {
            role: 'system',
            content: 'Você é uma secretária virtual. Recebe instruções em linguagem natural e responde com clareza e objetividade sobre compromissos, reuniões e tarefas.'
          },
          {
            role: 'user',
            content: mensagem
          }
        ]
      })
    });

    const data = await respostaIA.json();

    if (respostaIA.status !== 200) {
      return res.status(500).json({
        erro: 'Resposta inválida da OpenAI.',
        detalhes: data
      });
    }

    const respostaTexto = data.choices[0].message.content;

    await supabase.from('compromissos').insert([
      {
        mensagem_original: mensagem,
        resposta_gerada: respostaTexto
      }
    ]);

    return res.status(200).json({ resposta: respostaTexto });

  } catch (erro) {
    return res.status(500).json({
      erro: 'Erro ao processar a solicitação.',
      detalhes: erro.message
    });
  }
}
