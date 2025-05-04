// api/ia.js
import { createClient } from '@supabase/supabase-js';
import { Configuration, OpenAIApi } from 'openai';
import chrono from 'chrono-node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(process.env.TIMEZONE);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

export default async function handler(req, res) {
  // CORS e validações básicas
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem } = req.body;
  if (!mensagem)
    return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    // **1) MC Mark** – detectar intenção de MARCAR
    if (/marque|agende|schedule/i.test(mensagem)) {
      const data = chrono.parseDate(mensagem, new Date(), { forwardDate: true });
      if (!data) {
        return res
          .status(400)
          .json({ resposta: 'Não entendi a data/hora. Tente novamente.' });
      }
      // Título simples: toda a mensagem do usuário
      const titulo = mensagem;

      // Inserir no Supabase
      const { error: insertErr } = await supabase
        .from('appointments')
        .insert({ titulo, data_hora: dayjs(data).toISOString() });
      if (insertErr) throw insertErr;

      const fmt = dayjs(data).format('DD/MM/YYYY [às] HH:mm');
      return res
        .status(200)
        .json({ resposta: `Compromisso "${titulo}" marcado para ${fmt}.` });
    }

    // **Demais intenções (list, update, delete) virão depois...**
    return res
      .status(200)
      .json({ resposta: 'Ainda não consigo processar esse comando.' });
  } catch (err) {
    console.error('Erro no handler:', err);
    return res.status(500).json({ erro: err.message });
  }
}
