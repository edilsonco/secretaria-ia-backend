// api/ia.js

import { createClient } from '@supabase/supabase-js'
import { pt } from 'chrono-node'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(utc)
dayjs.extend(timezone)

// Nome exato da sua ENV var na Vercel:
const TZ = process.env.TIMEZONE || 'America/Sao_Paulo'
dayjs.tz.setDefault(TZ)

// Supabase URL e Chave (service_role!):
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY

if (!SUPABASE_URL)  throw new Error('Missing SUPABASE_URL')
if (!SUPABASE_KEY)  throw new Error('Missing SUPABASE_KEY')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` })
  }

  try {
    const { mensagem } = req.body
    if (!mensagem || typeof mensagem !== 'string') {
      return res.status(400).json({ error: 'Campo "mensagem" é obrigatório.' })
    }

    // 1) Parse de data/hora em PT
    const now = dayjs().tz(TZ).toDate()
    const results = pt.parse(mensagem, now, { forwardDate: true })
    if (!results.length) {
      return res.status(400).json({ error: 'Não identifiquei data/hora na mensagem.' })
    }

    const { start, text: parsedText } = results[0]
    const when = start.date()             // JS Date

    // 2) Extrair título simples
    let title = mensagem
      .replace(parsedText, '')
      .replace(/^(marque|agende|criar|adicionar)\s+/i, '')
      .trim()
    if (!title) title = 'Compromisso'

    // 3) Inserir no Supabase
    const { data: appointment, error } = await supabase
      .from('appointments')
      .insert({ titulo: title, data_hora: when.toISOString(), status: 'marcado' })
      .select()
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return res.status(500).json({ error: 'Falha ao salvar compromisso.' })
    }

    // 4) Formatar para retorno
    const formatted = dayjs(when).tz(TZ).format('DD/MM/YYYY [às] HH:mm')

    return res.status(200).json({
      confirmacao: `Compromisso "${appointment.titulo}" agendado para ${formatted}.`,
      id:          appointment.id,
      titulo:      appointment.titulo,
      data_hora:   formatted
    })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'Erro interno no servidor.' })
  }
}
