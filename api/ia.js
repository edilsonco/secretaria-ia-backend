// api/ia.js
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// — Variáveis de ambiente —
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TZ = process.env.TIMEZONE || 'America/Sao_Paulo';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('❌ SUPABASE_URL e SUPABASE_KEY são obrigatórios.');
}
if (!OPENAI_API_KEY) {
  throw new Error('❌ OPENAI_API_KEY é obrigatório.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export default async function handler(req, res) {
  try {
    const { mensagem } = req.body;
    // --- USO DO OPENAI PARA PARSER ---
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é uma assistente que recebe pedidos como "marque reunião…" e extrai título e data/hora.' },
        { role: 'user', content: mensagem }
      ],
      functions: [{
        name: 'schedule',
        description: 'Agenda um compromisso',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Título do compromisso' },
            datetime: { type: 'string', description: 'Timestamp ISO no fuso local' }
          },
          required: ['title', 'datetime']
        }
      }],
      function_call: { name: 'schedule' }
    });

    const fnCall = completion.choices[0].message.function_call;
    const { title, datetime } = JSON.parse(fnCall.arguments);

    // --- INSERÇÃO NO SUPABASE ---
    const { error: supErr } = await supabase
      .from('appointments')
      .insert([{ titulo: title, data_hora: datetime }]);

    if (supErr) throw supErr;

    // --- FORMATAÇÃO DA RESPOSTA ---
    const fmt = dayjs.utc(datetime).tz(TZ).format('DD/MM/YYYY [às] HH:mm');
    return res.status(200).json({ resposta: `Compromisso "${title}" marcado para ${fmt}.` });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: err.message });
  }
}
