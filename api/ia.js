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

    // Ajuste manual para variações de "hoje", "amanhã", "depois de amanhã", "semana que vem", dias da semana, dia do mês, "daqui a X dias", "no próximo mês" e "no próximo ano"
    const lowerMessage = mensagem.toLowerCase();
    let dateAdjusted = false;
    let nextMonthDetected = false;
    let nextYearDetected = false;

    // Verificar "no próximo ano"
    if (lowerMessage.includes('no próximo ano') || lowerMessage.includes('no proximo ano') || lowerMessage.includes('próximo ano') || lowerMessage.includes('proximo ano')) {
      nextYearDetected = true;
      console.log('Detectado "no próximo ano"');
    }

    // Verificar "no próximo mês"
    if (lowerMessage.includes('no próximo mês') || lowerMessage.includes('no proximo mes') || lowerMessage.includes('próximo mês') || lowerMessage.includes('proximo mes')) {
      nextMonthDetected = true;
      console.log('Detectado "no próximo mês"');
    }

    // Verificar "dia X" (ex.: dia 24)
    const dayMatch = lowerMessage.match(/dia\s+(\d{1,2})/);
    if (dayMatch) {
      const dayOfMonth = parseInt(dayMatch[1], 10);
      if (dayOfMonth >= 1 && dayOfMonth <= 31) {
        const currentDay = targetDate.date();
        const currentMonth = targetDate.month();
        const currentYear = targetDate.year();
        if (nextYearDetected) {
          // Se "no próximo ano" foi detectado, ajusta para o próximo ano com o dia especificado
          targetDate = targetDate.year(currentYear + 1).month(currentMonth).date(dayOfMonth);
          // Ajustar se o dia não existir no próximo ano (ex.: 29/02 em ano não bissexto)
          if (targetDate.date() !== dayOfMonth) {
            targetDate = targetDate.endOf('month');
          }
        } else if (nextMonthDetected) {
          // Se "no próximo mês" foi detectado, ajusta para o próximo mês com o dia especificado
          targetDate = targetDate.month(currentMonth + 1).date(dayOfMonth);
          // Ajustar se o dia não existir no próximo mês (ex.: 31 em fevereiro)
          if (targetDate.date() !== dayOfMonth) {
            targetDate = targetDate.endOf('month');
          }
          // Ajustar o ano se necessário (ex.: de dezembro para janeiro)
          if (targetDate.month() < currentMonth) {
            targetDate = targetDate.year(currentYear + 1);
          }
        } else {
          // Caso contrário, ajusta no mês atual ou próximo mês
          if (dayOfMonth >= currentDay) {
            targetDate = targetDate.date(dayOfMonth);
          } else {
            targetDate = targetDate.month(currentMonth + 1).date(dayOfMonth);
            if (targetDate.month() < currentMonth) {
              targetDate = targetDate.year(currentYear + 1).month(currentMonth + 1).date(dayOfMonth);
            }
          }
        }
        console.log(`Detectado "dia ${dayOfMonth}", ajustado para ${targetDate.format('DD/MM/YYYY')}`);
        dateAdjusted = true;
      }
    }

    // Verificar "daqui a X dias"
    const daquiMatch = lowerMessage.match(/daqui\s+a\s+(\d{1,2})\s+dias/);
    if (daquiMatch && !dateAdjusted) {
      const daysToAdd = parseInt(daquiMatch[1], 10);
      if (daysToAdd >= 1) {
        targetDate = targetDate.add(daysToAdd, 'day');
        console.log(`Detectado "daqui a ${daysToAdd} dias", ajustado para ${targetDate.format('DD/MM/YYYY')}`);
        dateAdjusted = true;
      }
    }

    // Verificar "no próximo ano" ou "no próximo mês" com dia da semana (ex.: "segunda-feira no próximo ano")
    let targetDayOfWeek = -1;
    let isNextWeekDay = false;
    let isWeekAfter = false;
    for (const [dayName, dayNumber] of Object.entries(daysOfWeek)) {
      if (lowerMessage.includes(dayName + ' da semana que vem') || lowerMessage.includes(dayName + ' da próxima semana') || lowerMessage.includes(dayName + ' da proxima semana')) {
        targetDayOfWeek = dayNumber;
        isWeekAfter = true;
        console.log(`Detectado "${dayName} da semana que vem" (número: ${dayNumber})`);
        break;
      } else if (lowerMessage.includes('próxima ' + dayName) || lowerMessage.includes('proxima ' + dayName)) {
        targetDayOfWeek = dayNumber;
        isNextWeekDay = true;
        console.log(`Detectado "próxima ${dayName}" (número: ${dayNumber})`);
        break;
      } else if (lowerMessage.includes(dayName)) {
        targetDayOfWeek = dayNumber;
        console.log(`Detectado dia da semana: ${dayName} (número: ${dayNumber})`);
        break;
      }
    }

    if (targetDayOfWeek !== -1 && !dateAdjusted) {
      const currentDayOfWeek = targetDate.day();
      let daysToAdd;
      if (nextYearDetected) {
        // Ajusta para o próximo ano primeiro
        const currentMonth = targetDate.month();
        const currentYear = targetDate.year();
        targetDate = targetDate.year(currentYear + 1).month(currentMonth).date(1);
        // Encontra a primeira ocorrência do dia da semana no mesmo dia/mês do próximo ano
        const firstDayOfNextYearMonth = targetDate.day();
        daysToAdd = targetDayOfWeek - firstDayOfNextYearMonth;
        if (daysToAdd < 0) {
          daysToAdd += 7;
        }
        targetDate = targetDate.add(daysToAdd, 'day');
        // Ajustar se o dia não existir (ex.: 29/02 em ano não bissexto)
        if (targetDate.date() !== targetDate.date()) {
          targetDate = targetDate.endOf('month');
        }
      } else if (nextMonthDetected) {
        // Ajusta para o próximo mês primeiro
        const currentMonth = targetDate.month();
        const currentYear = targetDate.year();
        targetDate = targetDate.month(currentMonth + 1).date(1);
        if (targetDate.month() < currentMonth) {
          targetDate = targetDate.year(currentYear + 1);
        }
        // Encontra a primeira ocorrência do dia da semana no próximo mês
        const firstDayOfNextMonth = targetDate.day();
        daysToAdd = targetDayOfWeek - firstDayOfNextMonth;
        if (daysToAdd < 0) {
          daysToAdd += 7;
        }
        targetDate = targetDate.add(daysToAdd, 'day');
        // Ajustar se o dia não existir no próximo mês (ex.: 31 em fevereiro)
        if (targetDate.date() !== targetDate.date()) {
          targetDate = targetDate.endOf('month');
        }
      } else if (isWeekAfter) {
        targetDate = targetDate.add(7, 'day');
        const newCurrentDayOfWeek = targetDate.day();
        daysToAdd = targetDayOfWeek - newCurrentDayOfWeek;
        if (targetDayOfWeek === currentDayOfWeek) {
          daysToAdd = 0;
        } else if (daysToAdd < 0) {
          daysToAdd += 7;
        }
        targetDate = targetDate.add(daysToAdd, 'day');
      } else {
        daysToAdd = targetDayOfWeek - currentDayOfWeek;
        if (daysToAdd <= 0 || isNextWeekDay) {
          daysToAdd += 7;
        }
        targetDate = targetDate.add(daysToAdd, 'day');
      }
      dateAdjusted = true;
    }

    // Verificar "semana que vem" ou "próxima semana" (sem dia da semana específico)
    if ((lowerMessage.includes('semana que vem') || lowerMessage.includes('próxima semana') || lowerMessage.includes('proxima semana')) &&
        !Object.keys(daysOfWeek).some(day => lowerMessage.includes(day + ' da semana que vem') || lowerMessage.includes(day + ' da próxima semana') || lowerMessage.includes(day + ' da proxima semana')) &&
        !dateAdjusted) {
      console.log('Detectado "semana que vem" (sem dia específico), adicionando 7 dias');
      targetDate = targetDate.add(7, 'day');
      dateAdjusted = true;
    }

    // Verificar "no próximo mês" (sem dia ou dia da semana específico)
    if (nextMonthDetected && !dateAdjusted) {
      const currentDay = targetDate.date();
      const currentMonth = targetDate.month();
      const currentYear = targetDate.year();
      targetDate = targetDate.month(currentMonth + 1).date(currentDay);
      // Ajustar se o dia não existir no próximo mês (ex.: 31 em fevereiro)
      if (targetDate.date() !== currentDay) {
        targetDate = targetDate.endOf('month');
      }
      // Ajustar o ano se necessário (ex.: de dezembro para janeiro)
      if (targetDate.month() < currentMonth) {
        targetDate = targetDate.year(currentYear + 1);
      }
      console.log(`Detectado "no próximo mês" (sem dia específico), ajustado para ${targetDate.format('DD/MM/YYYY')}`);
      dateAdjusted = true;
    }

    // Verificar "no próximo ano" (sem dia ou dia da semana específico)
    if (nextYearDetected && !dateAdjusted) {
      const currentDay = targetDate.date();
      const currentMonth = targetDate.month();
      const currentYear = targetDate.year();
      targetDate = targetDate.year(currentYear + 1).month(currentMonth).date(currentDay);
      // Ajustar se o dia não existir no próximo ano (ex.: 29/02 em ano não bissexto)
      if (targetDate.date() !== currentDay) {
        targetDate = targetDate.endOf('month');
      }
      console.log(`Detectado "no próximo ano" (sem dia específico), ajustado para ${targetDate.format('DD/MM/YYYY')}`);
      dateAdjusted = true;
    }

    if (lowerMessage.includes('hoje') && !dateAdjusted) {
      console.log('Detectado "hoje", mantendo a data atual');
      dateAdjusted = true;
    } else if ((lowerMessage.includes('depois de amanha') || lowerMessage.includes('depois de amanhã')) && !dateAdjusted) {
      console.log('Detectado "depois de amanhã", adicionando 2 dias');
      targetDate = targetDate.add(2, 'day');
      dateAdjusted = true;
    } else if ((lowerMessage.includes('amanha') || lowerMessage.includes('amanhã')) && !dateAdjusted) {
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

    // Extraia o título removendo a data/hora, verbos, "hoje/amanhã/depois de amanhã", "semana que vem", dias da semana, "dia X", "daqui a X dias", "no próximo mês" e "no próximo ano"
    let title = mensagem;
    title = title.replace(/\d{2}\/\d{2}\/\d{4}/gi, '').replace(/às\s*\d{1,2}(?::\d{2})?(?:\s*h)?/gi, '').replace(/às/gi, '').trim();
    title = title.replace(/hoje|amanha|amanhã|depois de amanha|depois de amanhã|semana que vem|próxima semana|proxima semana/gi, '').trim();
    // Remove dias da semana (com ou sem "próxima" ou "da semana que vem")
    for (const dayName of Object.keys(daysOfWeek)) {
      title = title.replace(new RegExp(`próxima ${dayName}|proxima ${dayName}|${dayName} da semana que vem|${dayName} da próxima semana|${dayName} da proxima semana|${dayName}`, 'gi'), '').trim();
    }
    // Remove "dia" e o número associado
    title = title.replace(/dia\s+\d{1,2}/gi, '').trim();
    // Remove "daqui a X dias"
    title = title.replace(/daqui\s+a\s+\d{1,2}\s+dias/gi, '').trim();
    // Remove "no próximo mês"
    title = title.replace(/no\s+próximo\s+mês|no\s+proximo\s+mes|próximo\s+mês|proximo\s+mes/gi, '').trim();
    // Remove "no próximo ano"
    title = title.replace(/no\s+próximo\s+ano|no\s+proximo\s+ano|próximo\s+ano|proximo\s+ano/gi, '').trim();
    title = title.replace(/Compromisso marcado:/gi, '').trim();
    const verbs = ['marque', 'marca', 'anote', 'anota', 'agende', 'agenda'];
    for (const verb of verbs) {
      if (title.toLowerCase().startsWith(verb + ' ')) {
        title = title.substring(verb.length + 1).trim();
        break;
      }
    }
    title = title.replace(/^\s*uma?\s+/i, '').trim(); // Remove "uma" ou "um" no início
    // Remove preposições "da" e "de" (em qualquer posição, com ou sem espaços)
    title = title.replace(/\b(da|de)\b/gi, '').replace(/\s+/g, ' ').trim();

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