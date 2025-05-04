// api/ia.js
import { createClient } from '@supabase/supabase-js'
import * as chrono from 'chrono-node'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(utc)
dayjs.extend(timezone)

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const TZ = process.env.TIMEZONE || 'UTC'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('⚠️ SUPABASE_URL e SUPABASE_KEY são obrigatórios!')
}
if (!OPENAI_API_KEY) {
  throw new Error('⚠️ OPENAI_API_KEY é obrigatório!')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

export default async function handler(req, res) {
  try {
    const { mensagem } = req.body
    if (!mensagem) {
      return res.status(400).json({ erro: 'Envie {"mensagem":"…"} no body.' })
    }

    // 1) Extrai data/hora via Chrono, usando a data de referência no seu fuso
    const referencia = dayjs().tz(TZ).toDate()
    const parsedDate = chrono.parseDate(mensagem, referencia, { forwardDate: true })
    if (!parsedDate) {
      return res
        .status(200)
        .json({ resposta: 'Não consegui identificar data e hora na sua mensagem.' })
    }

    // 2) Formata para timestamp ISO e grava no Supabase
    const quando = dayjs(parsedDate).tz(TZ).toISOString()
    const titulo = mensagem.replace(/(Marque|Agende|Agendar|Marcar)\s+reuni(ã|a)o\s+com\s+/i, '').trim()

    const { error } = await supabase
      .from('appointments')
      .insert({ titulo, data_hora: quando })

    if (error) throw error

    // 3) Retorna confirmação formatada para o usuário
    const fmt = dayjs(quando).tz(TZ).format('DD/MM/YYYY [às] HH:mm')
    return res.status(200).json({
      resposta: `Compromisso "Reunião com ${titulo}" marcado para ${fmt}.`
    })

  } catch (err) {
    console.error('Erro no handler:', err)
    return res.status(500).json({ erro: err.message })
  }
}
