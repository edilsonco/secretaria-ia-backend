export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ erro: 'Método não permitido. Use POST.' });
    }

    const { mensagem } = req.body;

    if (!mensagem || typeof mensagem !== 'string') {
      return res.status(400).json({ erro: 'Mensagem inválida.' });
    }

    const resposta = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Você é uma secretária inteligente. Sua tarefa é interpretar instruções do usuário para agendar, desmarcar ou lembrar eventos, e responder de forma clara e objetiva.' },
          { role: 'user', content: mensagem }
        ],
        temperature: 0.7
      })
    });

    const data = await resposta.json();

    if (data.choices && data.choices.length > 0) {
      return res.status(200).json({ resposta: data.choices[0].message.content });
    } else {
      return res.status(500).json({ erro: 'Resposta inválida da OpenAI.', detalhes: data });
    }

  } catch (erro) {
    return res.status(500).json({ erro: 'Erro interno.', detalhes: erro.message });
  }
}
