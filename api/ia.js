import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' })
  }

  const { mensagem } = req.body

  if (!mensagem) {
    return res.status(400).json({ erro: 'Mensagem não fornecida' })
  }

  // Buscar compromissos existentes
  const { data: compromissos, error: erroBusca } = await supabase
    .from('compromissos')
    .select('*')

  if (erroBusca) {
    return res.status(500).json({ erro: 'Erro ao buscar compromissos existentes.' })
  }

  const mensagemLower = mensagem.toLowerCase()

  // Comandos para desmarcar
  const comandosDesmarcar = ['desmarcar', 'desmarca', 'cancelar', 'cancela', 'remover', 'remove', 'apagar', 'excluir']
  const encontrouDesmarcar = comandosDesmarcar.find(cmd => mensagemLower.includes(cmd))

  if (encontrouDesmarcar) {
    const compromissoCorrespondente = compromissos.find(c => mensagemLower.includes(c.mensagem_original.toLowerCase()))

    if (compromissoCorrespondente) {
      await supabase
        .from('compromissos')
        .delete()
        .eq('id', compromissoCorrespondente.id)

      return res.status(200).json({ resposta: `Compromisso desmarcado com sucesso.` })
    } else {
      return res.status(200).json({ resposta: `Não encontrei o compromisso para desmarcar.` })
    }
  }

  // Comandos para editar
  const comandosEditar = ['editar', 'edite', 'edita', 'atualizar', 'atualize', 'atualiza', 'mudar', 'mude', 'muda', 'alterar', 'altere', 'altera']
  const encontrouEditar = comandosEditar.find(cmd => mensagemLower.includes(cmd))

  if (encontrouEditar) {
    const compromissoAlvo = compromissos.find(c => mensagemLower.includes(c.mensagem_original.toLowerCase()))

    if (compromissoAlvo) {
      await supabase
        .from('compromissos')
        .update({ mensagem_original: mensagem })
        .eq('id', compromissoAlvo.id)

      return res.status(200).json({ resposta: 'Compromisso atualizado com sucesso.' })
    } else {
      return res.status(200).json({ resposta: 'Não encontrei o compromisso para editar.' })
    }
  }

  // Requisição à OpenAI
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
  })

  const data = await respostaIA.json()

  if (respostaIA.status !== 200) {
    return res.status(500).json({
      erro: 'Resposta inválida da OpenAI.',
      detalhes: data,
    })
  }

  const respostaTexto = data.choices[0].message.content

  // Salvar no Supabase
  await supabase.from('compromissos').insert([
    {
      mensagem_original: mensagem,
      resposta_gerada: respostaTexto
    }
  ])

  res.status(200).json({ resposta: respostaTexto })
}
