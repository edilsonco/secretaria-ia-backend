import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const { mensagem } = req.body

  const textoMinusculo = mensagem.toLowerCase()
  const desmarcarSinonimos = ['desmarcar', 'desmarca', 'cancelar', 'cancela', 'remover', 'remova', 'excluir', 'exclui', 'apagar', 'apaga']
  const editarSinonimos = ['editar', 'edite', 'atualizar', 'atualize', 'modificar', 'modifica', 'muda', 'mude', 'altere', 'altera', 'troca', 'trocar']

  const contemAlgum = (lista) => lista.some((palavra) => textoMinusculo.startsWith(palavra))
  let respostaTexto = ''

  // 🗑️ DESMARCAR COMPROMISSO
  if (contemAlgum(desmarcarSinonimos)) {
    const termoBusca = mensagem.slice(mensagem.indexOf(' ') + 1).trim()

    const { data: encontrados } = await supabase
      .from('compromissos')
      .select('id, mensagem_original')
      .ilike('mensagem_original', `%${termoBusca}%`)
      .order('id', { ascending: false })

    if (encontrados && encontrados.length > 0) {
      await supabase.from('compromissos').delete().eq('id', encontrados[0].id)
      return res.status(200).json({ resposta: `O compromisso relacionado a "${termoBusca}" foi desmarcado com sucesso.` })
    } else {
      return res.status(200).json({ resposta: `Não encontrei nenhum compromisso com "${termoBusca}".` })
    }
  }

  // ✏️ DETECTAR INTENÇÃO DE EDIÇÃO
  if (contemAlgum(editarSinonimos)) {
    return res.status(200).json({ resposta: `Entendido. Por favor, diga qual informação deseja alterar no compromisso.` })
  }

  // 🧠 MEMÓRIA – CONSULTA HISTÓRICO
  const { data: historico } = await supabase
    .from('compromissos')
    .select('mensagem_original, resposta_gerada')
    .order('id', { ascending: true })
    .limit(5)

  const mensagensParaIA = [
    {
      role: 'system',
      content:
        'Você é uma secretária virtual confiável. Responda sempre com base nos compromissos registrados no histórico. Nunca invente informações novas. Seja breve e objetiva.',
    },
    ...(historico?.flatMap((item) => [
      { role: 'user', content: item.mensagem_original },
      { role: 'assistant', content: item.resposta_gerada }
    ]) || []),
    { role: 'user', content: mensagem }
  ]

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
  })

  const dataIA = await respostaIA.json()

  if (respostaIA.status !== 200) {
    return res.status(500).json({ erro: 'Erro ao consultar a OpenAI.', detalhes: dataIA })
  }

  respostaTexto = dataIA.choices[0].message.content

  // 💾 SALVAR NO SUPABASE
  const { error: erroInsert } = await supabase.from('compromissos').insert([
    {
      mensagem_original: mensagem,
      resposta_gerada: respostaTexto
    }
  ])

  if (erroInsert) {
    return res.status(500).json({ erro: 'Erro ao salvar no Supabase.', detalhes: erroInsert })
  }

  return res.status(200).json({ resposta: respostaTexto })
}
