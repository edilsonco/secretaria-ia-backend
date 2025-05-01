import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch (e) {
    return res.status(400).json({ erro: 'Corpo da requisição inválido' })
  }

  const { mensagem } = body
  if (!mensagem) {
    return res.status(400).json({ erro: 'Mensagem ausente na requisição' })
  }

  // Detecta intenção de desmarcar
  const desmarcarSinonimos = ['desmarcar', 'desmarque', 'desmarca', 'cancelar', 'cancela', 'cancelou', 'cancele', 'remover', 'remova', 'removi', 'removi', 'excluir', 'exclui', 'delete', 'deletar']
  const editarSinonimos = ['editar', 'edite', 'editando', 'editaram', 'mudar', 'mude', 'mudou', 'altere', 'alterar', 'trocar', 'troque', 'atualizar', 'atualize']

  const msgLower = mensagem.toLowerCase()

  // Verifica se é desmarcar
  const isDesmarcar = desmarcarSinonimos.some(palavra => msgLower.includes(palavra))
  const isEditar = editarSinonimos.some(palavra => msgLower.includes(palavra))

  if (isDesmarcar) {
    const { error } = await supabase
      .from('compromissos')
      .delete()
      .ilike('mensagem_original', `%${mensagem}%`)

    const respostaTexto = error
      ? 'Não consegui desmarcar o compromisso. Deseja tentar novamente?'
      : `Compromisso relacionado a "${mensagem}" desmarcado.`

    await supabase.from('compromissos').insert([
      {
        mensagem_original: mensagem,
        resposta_gerada: respostaTexto,
      }
    ])

    return res.status(200).json({ resposta: respostaTexto })
  }

  if (isEditar) {
    const { error } = await supabase
      .from('compromissos')
      .update({ mensagem_original: mensagem, resposta_gerada: 'Compromisso atualizado.' })
      .ilike('mensagem_original', `%${mensagem}%`)

    const respostaTexto = error
      ? 'Não consegui editar o compromisso. Pode tentar novamente?'
      : `Compromisso atualizado conforme instrução.`

    await supabase.from('compromissos').insert([
      {
        mensagem_original: mensagem,
        resposta_gerada: respostaTexto,
      }
    ])

    return res.status(200).json({ resposta: respostaTexto })
  }

  // Consulta compromissos anteriores
  const { data: compromissos } = await supabase
    .from('compromissos')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(10)

  const historico = compromissos.map(item => ({
    role: 'user',
    content: item.mensagem_original
  }))

  historico.push({
    role: 'user',
    content: mensagem
  })

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
          content: 'Você é uma secretária virtual. Recebe instruções em linguagem natural e responde com clareza sobre compromissos, reuniões e tarefas. Lembre-se do que foi agendado.'
        },
        ...historico
      ]
    })
  })

  const data = await respostaIA.json()

  if (respostaIA.status !== 200) {
    return res.status(500).json({
      erro: 'Erro ao processar a resposta da IA.',
      detalhes: data,
    })
  }

  const respostaTexto = data.choices[0].message.content

  await supabase.from('compromissos').insert([
    {
      mensagem_original: mensagem,
      resposta_gerada: respostaTexto,
    }
  ])

  res.status(200).json({ resposta: respostaTexto })
}
