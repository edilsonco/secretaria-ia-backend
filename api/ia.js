import { createClient } from '@supabase/supabase-js';
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// Estenda o dayjs com plugins
dayjs.extend(utc);
dayjs.extend(timezone);

// Defina o fuso horário padrão
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo';
dayjs.tz.setDefault(TIMEZONE);

// Inicialize o cliente do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { mensagem } = req.body;
    if (!mensagem) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }

    // Parseie a mensagem com chrono-node para extrair data/hora
    const parsed = chrono.parse(mensagem, new Date(), { timezone: TIMEZONE, forwardDate: true });
    if (parsed.length === 0) {
      return res.status(400).json({ error: 'Nenhuma data/hora encontrada na mensagem' });
    }

    // Use o primeiro resultado de parsing
    const parsedDate = parsed[0];
    let rawDate = parsedDate.start.date();

    // Ajuste para garantir que "amanhã" seja interpretado corretamente
    if (parsedDate.text.toLowerCase().includes('amanhã')) {
      rawDate = dayjs(rawDate).add(1, 'day').toDate();
    }

    // Ajuste o fuso horário explicitamente para America/Sao_Paulo
    const dataHora = dayjs(rawDate).tz(TIMEZONE, true).toDate();

    // Extraia o título removendo a data/hora e verbos como "Marque", "Agende"
    let title = mensagem.replace(parsedDate.text, '').trim();
    const verbs = ['Marque', 'Agende'];
    for (const verb of verbs) {
      if (title.startsWith(verb + ' ')) {
        title = title.substring(verb.length + 1).trim();
        break;
      }
    }

    // Insira o registro no Supabase
    const { data, error } = await supabase
      .from('appointments')
      .insert([{ titulo: title, data_hora: dataHora, status: 'marcado' }])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Formate a data para a resposta
    const formattedDate = dayjs(dataHora).tz(TIMEZONE).format('DD/MM/YYYY [às] HH:mm');

    return res.status(200).json({ mensagem: `Compromisso marcado: ${title} em ${formattedDate}` });
  } else {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  }
}