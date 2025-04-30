export default async function handler(req, res) {
  // 🔓 Permitir acesso externo à API (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // CORS pré-verificação
  }

  // ✅ Continua se for método POST
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { mensagem } = req.body;

  if (!mensagem) {
    return res.status(400).json({ erro: 'Mensagem não fornecida' });
  }

  try {
    const respostaIA = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Você é uma secretária virtual. Recebe instruções em linguagem natural e responde com clareza e objetividade sobre compromissos, reuniões e tarefas.',
          },
          {
            role: 'user',
            content: mensagem,
          },
        ],
        temperature: 0.5,
      }),
    });

    const data = await respostaIA.json();

    if (respostaIA.status !== 200) {
      return res.status(500).json({
        erro: 'Resposta inválida da OpenAI.',
        detalhes: data,
      });
    }

    const respostaTexto = data.choices?.[0]?.message?.content || 'Sem resposta.';

    return res.status(200).json({ resposta: respostaTexto });
  } catch (erro) {
    return res.status(500).json({ erro: 'Erro ao se comunicar com a OpenAI.', detalhes: erro.message });
  }
}
