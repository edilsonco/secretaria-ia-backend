// api/ia.js

// 1) Garante o fuso de SP
process.env.TZ = process.env.TIMEZONE || 'America/Sao_Paulo';

import { createClient } from '@supabase/supabase-js';
import * as chrono from 'chrono-node';

// 2) Carrega e registra o parser de PT-BR
import pt from 'chrono-node/dist/esm/locales/pt/index.js';
chrono.parsers.unshift(...pt.parsers);
chrono.refiners.unshift(...pt.refiners);

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// 3) Configura Day.js para SP
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(process.env.TIMEZONE || 'America/Sao_Paulo');

// 4) Cliente Supabase
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
    // 5) Parse em linguagem natural
    const resultados = chrono.parse(mensagem, new Date());
    const parsed = resultados.find(r => r.start);
    if (!parsed) {
      return res
        .status(400)
        .json({ resposta: 'Não entendi a data/hora. Pode reformular?' });
    }

    const data = parsed.start.date();

    // 6) Extrai título tirando a parte de data/hora
    let titulo = mensagem
      .replace(parsed.text, '')
      .replace(/^(Marque|Agende|Reserve)\s*/i, '')
      .trim();
    if (!titulo) titulo = 'Compromisso';

    // 7) Insere no Supabase
    const { error } = await supabase
      .from('appointments')
      .insert({ titulo, data_hora: dayjs(data).toISOString() });

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    // 8) Formata resposta em PT-BR
    const fmt = dayjs(data).format('DD/MM/YYYY [às] HH:mm');
    return res
      .status(200)
      .json({ resposta: `Compromisso "${titulo}" marcado para ${fmt}.` });
  } catch (err) {
    console.error('Erro no handler:', err);
    return res.status(500).json({ erro: err.message });
  }
}
