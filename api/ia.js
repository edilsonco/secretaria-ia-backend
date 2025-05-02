import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ───────────────────────────────────────── */

export default async function handler(req, res) {
  // CORS pré-flight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')  return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem } = req.body;
  if (!mensagem) return res.status(400).json({ erro: 'Campo "mensagem" obrigatório' });

  /* ───────────── PARSE DA MENSAGEM ───────────── */
  const regexMarcar   = /marque .*?com ([\p{L}\s]+?) (?:amanh[ãa]|(\d{4}-\d{2}-\d{2})) .*? (\d{1,2}h|\d{2}:\d{2})/iu;
  const regexListar   = /quais|meus? compromissos/iu;
  const regexCancelar = /desmarc|cancela|remove/iu;
  const regexAlterar  = /muda|alter[ae]/iu;

  try {
    /* LISTAR -------------------------------------------------- */
    if (regexListar.test(mensagem)) {
      const { data } = await supabase
        .from('appointments')
        .select('*')
        .eq('status', 'marcado')
        .order('data_hora');

      const resposta =
        data.length === 0
          ? 'Você não tem compromissos marcados.'
          : 'Compromissos:\n' +
            data.map(c =>
              `• ${c.titulo} @ ${new Date(c.data_hora).toLocaleString('pt-BR')}`
            ).join('\n');

      return res.status(200).json({ resposta });
    }

    /* MARCAR -------------------------------------------------- */
    const m = mensagem.match(regexMarcar);
    if (m) {
      const pessoa = m[1].trim();
      const dataStr = m[2] ?? (/\bamanh[ãa]\b/i.test(mensagem)
                      ? new Date(Date.now()+864e5).toISOString().slice(0,10)
                      : null);
      const horaStr = m[3].replace('h',':00');

      if (!dataStr) return res.status(400).json({ resposta: 'Por favor informe a data.' });

      const dataHoraISO = `${dataStr}T${horaStr.padStart(5,'0')}:00`;

      await supabase.from('appointments').insert({
        titulo: `Reunião com ${pessoa}`,
        data_hora: dataHoraISO
      });

      return res.status(200).json({
        resposta: `Compromisso "Reunião com ${pessoa}" marcado para ${new Date(dataHoraISO).toLocaleString('pt-BR')}.`
      });
    }

    /* CANCELAR / ALTERAR ainda não implementado */
    return res.status(200).json({ resposta: 'Comando não reconhecido. Peça-me para marcar ou listar compromissos.' });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Falha interna', detalhes: e.message });
  }
}
