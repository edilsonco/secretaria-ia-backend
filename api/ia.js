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

  const msgLower = mensagem.toLowerCase();

  // 🗑️ Desmarcar (deletar do banco)
  const comandosDesmarcar = ['desmarcar', 'desmarca', 'cancelar', 'cancela', 'remover', 'remova', 'excluir', 'exclui', 'apagar', 'apaga'];
  const encontrouDesmarcar = comandosDesmarcar.find(comando => msgLower.startsWith(comando));

  if (encontrouDesmarcar) {
    const termoBusca = mensagem.slice(encontrouDesmarcar.length).trim();

    const { data: compromissosEncontrados } = await supabase
      .from('compromissos')
      .select('id, mensagem_original')
      .ilike('mensagem_original', `%${termoBusca}%`)
      .order('id', { ascending: false });

    if (compromissosEncontrados && compromissosEncontrados.length > 0) {
      const compromissoParaApagar = compromissosEncontrados[0];

      await supabase
        .from('compromissos')
        .delete()
        .eq('id', compromissoParaApagar.id);

      return res.status(200).json({
        resposta: `O compromisso relacionado a "${termoBusca}" foi desmarcado com sucesso.`
      });
    } else {
      return res.status(200).json({
        resposta: `Não encontrei nenhum compromisso relacionado a "${termoBusca}".`
      });
    }
  }

  // ✏️ Alterar (editar mensagem salva)
  const comandosEditar = ['editar', 'muda', 'mudar', 'altera', 'alterar', 'troca', 'trocar', 'atualiza', 'atualizar', 'modifica', 'modificar'];
  const encontrouEditar = comandosEditar.find(comando => msgLower.startsWith(comando));

  if (encontrouEditar) {
    const termoBusca = mensagem.slice(encontrouEditar.length).trim();

    const { data: compromissosEncontrados } = await supabase
      .from('compromissos')
      .select('id, mensagem_original')
      .ilike('mensagem_original', `%${termoBusca}%`)
      .order('id', { ascending: false });

    if (compromissosEncontrados && compromissosEncontrados.length > 0) {
      const compromissoParaEditar = compromissosEncontrados[0];

      await supabase
        .from('compromissos')
        .update({ mensagem_original: mensagem })
        .eq('id', compromissoParaEditar.id);

      return res.status(200).json({
        resposta: `O compromisso foi atualizado com sucesso.`
      });
    } else {
      return res.status(200).json({
        resposta: `Não encontrei nenhum compromisso correspondente para editar.`
      });
    }
  }

  // 🧠 Memória (leitura de histórico)
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
}
