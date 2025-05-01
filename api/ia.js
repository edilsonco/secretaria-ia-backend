import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  // Cabeçalhos CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

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

  const mensagemLower = mensagem.toLowerCase()

  const sinonimosDesmarcar = ['desmarcar', 'cancele', 'cancelar', 'remover', 'remova', 'excluir', 'exclua', 'desmarca']
  const sinonimosEditar = ['editar', 'mudar', 'modificar', 'alterar', 'trocar', 'edite', 'mude', 'modifique', 'altere', 'troque']

  const { data: compromissos } = await supabase
    .from('compromissos')
    .select('*')

  for (const palavra of sinonimosDesmarcar) {
    if (mensagemLower.includes(palavra)) {
      for (const compromisso of compromissos) {
        if (mensagemLower.includes(compromisso.resposta_gerada.toLowerCase())) {
          await supabase
            .from('compromissos')
            .delete()
            .eq('id', compromisso.id)

          return res.status(200).json({ resposta: `Compromisso removido com sucesso.` })
        }
      }
    }
  }

  for (const palavra of sinonimosEditar) {
    if (mensagemLower.includes(palavra)) {
      for (const compromisso of compromissos) {
        if (mensagemLower.includes(compromisso.resposta_gerada.toLowerCase())) {
          await supabase
            .from('compromissos')
            .delete()
            .eq('id', compromisso.id)
          break
        }
      }
    }
  }

  if (mensagemLower.includes('tenho compromisso') || mensagemLower.includes('quais compromissos')) {
    const compromissosTexto = compromissos.map(c => `- ${c.resposta_gerada}`).join('\n') || 'Você não tem compromissos marcados.'
    return res.status(200).json({ resposta: compromissosTexto })
  }

  const respostaIA = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content:
            'Você é uma secretária virtual. Recebe instruções em linguagem natural e responde com clareza e objetividade sobre compromissos, reuniões e tarefas.',
        },
        {
          role: 'user',
          content: mensagem,
        },
      ],
    }),
  })

  const data = await respostaIA.json()

  if (respostaIA.status !== 200) {
    return res.status(500).json({ erro: 'Erro ao obter resposta da OpenAI', detalhes: data })
  }

  const respostaTexto = data.choices[0].message.content

  await supabase.from('compromissos').insert([
    {
      mensagem_original: mensagem,
      resposta_gerada: respostaTexto,
    },
  ])

  res.status(200).json({ resposta: respostaTexto })
}
