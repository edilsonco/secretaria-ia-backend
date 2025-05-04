// api/ia.js
import { createClient } from '@supabase/supabase-js';
import chrono from 'chrono-node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    const { mensagem } = req.body;
    const parsed = chrono.parseDate(mensagem, new Date(), { forwardDate: true });
    if (!parsed) {
      return res.status(400).json({ resposta: 'Desculpe, não entendi a data/hora.' });
    }
    const dt = dayjs(parsed).tz(process.env.TIMEZONE || 'UTC').toISOString();
    // tira “marque/agende” do texto e tudo depois da data/hora
    const titulo = mensagem
      .replace(/^(marque|reserve|agende)\s+/i, '')
      .replace(/(hoje|amanh[ãa]|[\d\/\-\:\shH]+h?)/i, '')
      .trim();
    const { error } = await supabase
      .from('appointments')
      .insert({ titulo, data_hora: dt, status: 'marcado' });
    if (error) throw error;
    const fmt = dayjs(dt).tz(process.env.TIMEZONE || 'UTC').format('DD/MM/YYYY [às] HH:mm');
    return res.status(200).json({ resposta: `Compromisso "${titulo}" marcado para ${fmt}.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ resposta: 'Erro interno no servidor.' });
  }
}
