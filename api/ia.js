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

    // Crie uma data de referência no fuso horário local
    const referenceDate = dayjs().tz(TIMEZONE).toDate();

    // Parseie a mensagem com chrono-node para a data
    const parsed = chrono.parse(mensagem, referenceDate, { forwardDate: true, timezones: [TIMEZONE] });
    if (parsed.length === 0) {
      return res.status(400).json({ error: 'Nenhuma data/hora encontrada na mensagem' });
    }

    // Use o primeiro resultado de parsing para a data
    const parsedDate = parsed[0];
    let targetDate = dayjs(referenceDate).tz(TIMEZONE, true);

    // Ajuste manual para "amanhã"
    if (mensagem.toLowerCase().includes('amanhã')) {
      targetDate = targetDate.add(1, 'day');
    }

    // Ajuste manual se a data específica estiver na mensagem
    const dateMatch = mensagem.match(/\d{2}\/\d{2}\/\d{4}/);
    if (dateMatch) {
      const [day, month, year] = dateMatch[0].split('/');
      targetDate = targetDate.year(parseInt(year)).month(parseInt(month) - 1).date(parseInt(day));
    }

    // Extraia a hora manualmente usando regex (aceitando "às HHh" ou "às HH:MM")
    const timeMatch = mensagem.match(/às\s*(\d{1,2})(?::(\d{2}))?h?/i);
    let hour = 0;
    let minute = 0;
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      if (hour === 12 && mensagem.toLowerCase().includes('am')) hour = 0; // Ajuste para AM
      if (hour < 12 && mensagem.toLowerCase().includes('pm')) hour += 12; // Ajuste para PM
      if (hour > 23) hour = hour % 24; // Normaliza horas acima de 23
    } else {
      // Fallback para o chrono-node se não encontrar a hora
      hour = parsedDate.start.get('hour');
      minute = parsedDate.start.get('minute') || 0;
    }

    // Aplique a hora e minuto manualmente
    targetDate = targetDate.hour(hour).minute(minute).second(0);

    // Converta para Date para o Supabase
    const dataHora = targetDate.toDate();

    // Extraia o título removendo a data/hora, verbos e "amanhã"
    let title = mensagem;
    title = title.replace(/\d{2}\/\d{2}\/\d{4}/gi, '').replace(/às\s*\d{1,2}(:\d{2})?h?/gi, '').replace(/às/gi, '').trim();
    title = title.replace(/amanhã/gi, '').trim();
    title = title.replace(/Compromisso marcado:/gi, '').trim();
    const verbs = ['marque', 'agende'];
    for (const verb of verbs) {
      if (title.toLowerCase().startsWith(verb + ' ')) {
        title = title.substring(verb.length + 1).trim();
        break;
      }
    }
    title = title.replace(/^\s*uma?\s+/i, '').trim(); // Remove "uma" ou "um" no início

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