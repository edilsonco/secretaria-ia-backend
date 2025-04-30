export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido' });
  }

  const { mensagem } = req.body;

  if (!mensagem) {
    return res.status(400).json({ message: 'Mensagem vazia' });
  }

  try {
    const resposta = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'Você é uma assistente pessoal que ajuda a organizar compromissos de forma simples e prática.' },
          { role: 'user', content: mensagem },
        ],
        temperature: 0.6,
      }),
    });

    const data = await resposta.json();
    const respostaTexto = data.choices?.[0]?.message?.content || 'Erro ao interpretar a mensagem.';

    res.status(200).json({ resposta: respostaTexto });
  } catch (erro) {
    res.status(500).json({ message: 'Erro ao consultar a OpenAI', erro: erro.message });
  }
}
