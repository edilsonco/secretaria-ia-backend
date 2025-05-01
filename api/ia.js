import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const { mensagem } = req.body

  // Buscar compromissos anteriores
  const { data: compromissos } = await supabase
    .from('compromissos')
    .select('mensagem_original, resposta_gerada')
    .order('id', { ascending: true }) // mantém ordem cronológica

  // Construir contexto com histórico
  const historico = compromissos.map(c => ({
    role: 'user',
    content: c.mensagem_original
  })).concat(compromissos.map(c => ({
    role: 'assistant',
    content: c.resposta_gerada
  })))

  // Preparar chamada para OpenAI
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
          content: `Você é uma secretária virtual eficiente e confiável. Sempre baseie suas respostas exclusivamente nos compromissos listados no histórico fornecido.
          Reproduza nomes, horários e descrições exatamente como foram registrados.
          Não invente informações novas e não modifique os dados salvos. Seja clara, objetiva e útil.`
        },
        ...historico,
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
