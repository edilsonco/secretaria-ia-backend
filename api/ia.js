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
    // Buscar os últimos compromissos para compor a memória
    const { data: compromissos } = await supabase
      .from('compromissos')
      .select('mensagem_original, resposta_gerada')
      .order('id', { ascending: true })
      .limit(5);

    const historico = compromissos?.flatMap((item) => [
      { role: 'user', content: item.mensagem_original },
      { role: 'assistant', content: item.resposta_gerada }
    ]) || [];

    const mensagensParaIA = [
      {
        role: 'system',
        content: `Você é uma secretária virtual eficiente e confiável. Sempre baseie suas respostas exclusivamente nos compromissos listados no histórico fornecido. Reproduza nomes, horários e descrições exatamente como foram registrados. Não invente informações novas e não modifique os dados salvos. Seja clara, objetiva e útil.`
      },
      ...historico,
      {
        role: 'user',
        content: mensagem
      }
    ];

    const respostaIA = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        temperature: 0.5,
        messages: mensagensParaIA
      })
    });

    const data = await respostaIA.json();

    if (respostaIA.status !== 200) {
      return res.status(500).json({
        erro: 'Erro ao consultar a OpenAI.',
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
      erro: 'Erro interno na função.',
      detalhes: erro.message
    });
  }
}
