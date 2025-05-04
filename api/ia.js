import { createClient } from '@supabase/supabase-js';
import { pt } from 'chrono-node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// configura dayjs
dayjs.extend(utc);
dayjs.extend(timezone);
const defaultTimezone = process.env.TIMEZONE || 'America/Sao_Paulo';
dayjs.tz.setDefault(defaultTimezone);

// valida variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
if (!supabaseKey) throw new Error("Missing SUPABASE_KEY");

// inicializa supabase
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { mensagem } = req.body;
    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ error: 'Campo "mensagem" é obrigatório.' });
    }

    // parsing de data/hora
    const agora   = dayjs().tz(defaultTimezone).toDate();
    const results = pt.parse(mensagem, agora, { forwardDate: true });
    if (!results.length) {
      return res.status(400).json({ error: 'Não foi possível identificar data/hora.' });
    }

    const result  = results[0];
    const start   = result.start;
    let when      = start.date();

    // se minuto não foi especificado (implícito), zera para :00
    if (!start.isCertain('minute')) {
      when.setMinutes(0, 0, 0);
    }

    const textoDataHora = result.text;

    // extrai título (remove data/hora e verbos iniciais)
    let titulo = mensagem
      .replace(textoDataHora, '')
      .replace(/^(Marque|Agende|Criar|Adicionar|Lembrete)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!titulo) titulo = 'Compromisso';

    // insere no Supabase
    const { data: insertData, error: insertError } = await supabase
      .from('appointments')
      .insert([{
        titulo,
        data_hora: when.toISOString(),
        status: 'marcado'
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Erro ao inserir:', insertError);
      return res.status(500).json({ error: 'Erro ao salvar compromisso.' });
    }

    // formata data para retorno
    const dataHoraFormatada = dayjs(when)
      .tz(defaultTimezone)
      .format('DD/MM/YYYY [às] HH:mm');

    return res.status(200).json({
      confirmacao: `Compromisso "${insertData.titulo}" agendado para ${dataHoraFormatada}.`,
      id: insertData.id,
      titulo: insertData.titulo,
      data_hora: dataHoraFormatada
    });

  } catch (error) {
    console.error('Erro na API:', error);
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
    }
    return res.status(500).json({ error: 'Erro interno no servidor.' });
  }
}
