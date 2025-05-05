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

// Mapeamento de dias da semana para números (0 = domingo, 1 = segunda, ..., 6 = sábado)
const daysOfWeek = {
  'domingo': 0,
  'segunda-feira': 1, 'segunda': 1,
  'terça-feira': 2, 'terça': 2,
  'quarta-feira': 3, 'quarta': 3,
  'quinta-feira': 4, 'quinta': 4,
  'sexta-feira': 5, 'sexta': 5,
  'sábado': 6, 'sabado': 6
};

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

    // Ajuste manual para variações de "hoje", "amanhã", "depois de amanhã" e dias da semana
    const lowerMessage = mensagem.toLowerCase();
    let dateAdjusted = false;

    // Verificar dias da semana
    let targetDayOfWeek = -1;
    for (const [dayName, dayNumber] of Object.entries(daysOfWeek)) {
      if (lowerMessage.includes(dayName)) {
        targetDayOfWeek = dayNumber;
        console.log(`Detectado dia da semana: ${dayName} (número: ${dayNumber})`);
        break;
      }
    }

    if (targetDayOfWeek !== -1) {
      const currentDayOfWeek = targetDate.day(); // 0 = domingo, 1 = segunda, ..., 6 = sábado
      let daysToAdd = targetDayOfWeek - currentDayOfWeek;
      if (daysToAdd <= 0) {
        daysToAdd += 7; // Garante que seja a próxima ocorrência do dia
      }
      targetDate = targetDate.add(daysToAdd, 'day');
      dateAdjusted = true;
    } else if (lowerMessage.includes('hoje')) {
      console.log('Detectado "hoje", mantendo a data atual');
      // Não adiciona dias, mantém a data atual
      dateAdjusted = true;
    } else if (lowerMessage.includes('depois de amanha') || lowerMessage.includes('depois de amanhã')) {
      console.log('Detectado "depois de amanhã", adicionando 2 dias');
      targetDate = targetDate.add(2, 'day');
      dateAdjusted = true;
    } else if (lowerMessage.includes('amanha') || lowerMessage.includes('amanhã')) {
      console.log('Detectado "amanhã", adicionando 1 dia');
      targetDate = targetDate.add(1, 'day');
      dateAdjusted = true;
    }

    // Ajuste manual se a data específica estiver na mensagem
    const dateMatch = mensagem.match(/\d{2}\/\d{2}\/\d{4}/);
    if (dateMatch) {
      const [day, month, year] = dateMatch[0].split('/');
      targetDate = targetDate.year(parseInt(year)).month(parseInt(month) - 1).date(parseInt(day));
    } else if (!dateAdjusted && parsedDate.start) {
      targetDate = dayjs(parsedDate.start.date()).tz(TIMEZONE, true);
    }

    // Extraia a hora manualmente usando regex (aceitando "às HHh" ou "às HH:MM")
    const timeMatch = mensagem.match(/às\s*(\d{1,2})(?::(\d{2}))?(?:\s*h)?/i);
    let hour = 0;
    let minute = 0;
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      if (hour === 12 && lowerMessage.includes('am')) hour = 0; // Ajuste para AM
      if (hour < 12 && lowerMessage.includes('pm')) hour += 12; // Ajuste para PM
      if (hour > 23) hour = hour % 24; // Normaliza horas acima de 23
    } else {
      return res.status(400).json({ error: 'Hora não encontrada na mensagem' });
    }

    // Aplique a hora e minuto manualmente
    targetDate = targetDate.hour(hour).minute(minute).second(0);

    // Converta para Date para o Supabase
    const dataHora = targetDate.toDate();

    // Extraia o título removendo a data/hora, verbos, "hoje/amanhã/depois de amanhã" e dias da semana
    let title = mensagem;
    title = title.replace(/\d{2}\/\d{2}\/\d{4}/gi, '').replace(/às\s*\d{1,2}(?::\d{2})?(?:\s*h)?/gi, '').replace(/às/gi, '').trim();
    title = title.replace(/hoje|amanha|amanhã|depois de amanha|depois de amanhã/gi, '').trim();
    // Remove dias da semana
    for (const dayName of Object.keys(daysOfWeek)) {
      title = title.replace(new RegExp(dayName, 'gi'), '').trim();
    }
    title = title.replace(/Compromisso marcado:/gi, '').trim();
    const verbs = ['marque', 'marca', 'anote', 'anota', 'agende', 'agenda'];
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