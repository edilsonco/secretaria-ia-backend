// api/ia.js

// 1) Garante o fuso de SP (UTC–3)
process.env.TZ = process.env.TIMEZONE || 'America/Sao_Paulo';

import { createClient } from '@supabase/supabase-js';
import chrono from 'chrono-node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// 2) Configura Day.js para UTC e fuso
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(process.env.TIMEZONE || 'America/Sao_Paulo');

// 3) Cliente Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { mensagem } = req.body || {};
  if (!mensagem || typeof mensagem !== 'string') {
    return res
      .status(400)
      .json({ erro: 'Envie um JSON com chave "mensagem" de texto.' });
  }

  try {
    // 4) Parse de data/hora em linguagem natural
    const date = chrono.parseDate(mensagem, new Date());
    if (!date) {
      return res
        .status(400)
        .json({ resposta: 'Não entendi a data/hora. Pode reformular?' });
    }

    // 5) Extrai título (tira a parte de data/hora e possíveis verbos)
    let titulo = mensagem
      .replace(chrono.parse(mensagem)[0]?.text || '', '')
      .replace(/^(Marque|Agende|Reserve)\s*/i, '')
      .trim();
    if (!titulo) titulo = 'Compromisso';

    // 6) Insere no Supabase
    const { error } = await supabase
      .from('appointments')
      .insert({ titulo, data_hora: dayjs(date).toISOString() });

    if (error) throw error;

    // 7) Formata resposta
    const fmt = dayjs(date).format('DD/MM/YYYY [às] HH:mm');
    return res
      .status(200)
      .json({ resposta: `Compromisso "${titulo}" marcado para ${fmt}.` });
  } catch (err) {
    console.error('Erro no handler:', err);
    return res.status(500).json({ erro: err.message });
  }
}
