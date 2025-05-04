// api/ia.js

// 1) Força o Node a usar o fuso de São Paulo
process.env.TZ = 'America/Sao_Paulo';

import { createClient }    from '@supabase/supabase-js';
import * as chrono         from 'chrono-node';
import dayjs               from 'dayjs';
import utc                 from 'dayjs/plugin/utc.js';
import timezone            from 'dayjs/plugin/timezone.js';

// 2) Configura o Day.js para sempre usar America/Sao_Paulo
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('America/Sao_Paulo');

// 3) Constrói o cliente Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { mensagem } = req.body || {};
  if (!mensagem) {
    return res.status(400).json({ erro: 'Envie { "mensagem": "..."} no body.' });
  }

  try {
    // 4) Parseia a data/hora em linguagem natural
    const parsed = chrono.parse(mensagem, new Date(), { timezone: 'America/Sao_Paulo' })[0];
    if (!parsed || !parsed.start) {
      return res
        .status(400)
        .json({ resposta: 'Não entendi a data/hora. Pode reformular?' });
    }
    const data = parsed.start.date();

    // 5) Extrai o título com uma heurística simples:
    //    tira do texto a parte reconhecida como data e as palavras iniciais de agendamento.
    let titulo = mensagem
      .replace(parsed.text, '')
      .replace(/^(Marque|Agende|Reserve)\s*/i, '')
      .trim();
    if (!titulo) titulo = 'Compromisso';

    // 6) Insere no Supabase (table "appointments" com colunas: titulo text, data_hora timestamp)
    const { error } = await supabase
      .from('appointments')
      .insert({ titulo, data_hora: dayjs(data).toISOString() });

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    // 7) Formata a data de volta em PT-BR
    const fmt = dayjs(data).format('DD/MM/YYYY [às] HH:mm');
    return res
      .status(200)
      .json({ resposta: `Compromisso "${titulo}" marcado para ${fmt}.` });
  } catch (err) {
    console.error('Erro no handler:', err);
    return res.status(500).json({ erro: err.message });
  }
}
