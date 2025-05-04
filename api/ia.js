// api/ia.js

import { createClient } from '@supabase/supabase-js';
import { pt } from 'chrono-node'; // Importa o locale PT diretamente
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// Configura dayjs com plugins e timezone padrão
dayjs.extend(utc);
dayjs.extend(timezone);
const defaultTimezone = process.env.TIMEZONE || 'America/Sao_Paulo'; // Usa variável de ambiente ou fallback
dayjs.tz.setDefault(defaultTimezone);

// Valida se as variáveis de ambiente do Supabase estão presentes
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Deve ser a service_role key

if (!supabaseUrl) {
  throw new Error("Missing environment variable SUPABASE_URL");
}
if (!supabaseKey) {
  throw new Error("Missing environment variable SUPABASE_KEY (service_role)");
}

// Inicializa o cliente Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// Função principal do endpoint
export default async function handler(req, res) {
  // 1. Verificar Método HTTP
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // 2. Obter e Validar Corpo da Requisição
    const { mensagem } = req.body;
    if (!mensagem || typeof mensagem !== 'string' || mensagem.trim() === '') {
      return res.status(400).json({ error: 'Campo "mensagem" é obrigatório e não pode ser vazio.' });
    }

    // 3. Parse da Data/Hora com Chrono-node
    // Usamos pt.parse para obter mais detalhes, incluindo o texto correspondente à data
    const agora = dayjs().tz(defaultTimezone).toDate(); // Referência de tempo no fuso correto
    const resultados = pt.parse(mensagem, agora, { forwardDate: true });

    if (!resultados || resultados.length === 0) {
      return res.status(400).json({ error: 'Não foi possível identificar uma data/hora na mensagem.' });
    }

    // Assume o primeiro resultado como o mais provável
    const resultadoParse = resultados[0];
    const dataHoraCompromisso = resultadoParse.start.date(); // JS Date Object
    const textoDataHora = resultadoParse.text; // O trecho de texto que foi interpretado como data/hora

    // 4. Extração Simplificada do Título
    // Remove o texto da data/hora e verbos comuns do início
    let titulo = mensagem
      .replace(textoDataHora, '') // Remove o texto da data/hora
      .replace(/^(Marque|Agende|Criar|Adicionar|Lembrete)\s+/i, '') // Remove verbos comuns no início (case-insensitive)
      .replace(/\s+/g, ' ') // Remove espaços extras
      .trim();

    // Se o título ficar vazio após as remoções, use um padrão ou a mensagem original
    if (!titulo) {
        titulo = "Compromisso"; // Ou poderia usar a mensagem original sem a data
    }

    // 5. Inserir no Supabase
    const { data: insertData, error: insertError } = await supabase
      .from('appointments')
      .insert([
        {
          titulo: titulo,
          data_hora: dataHoraCompromisso.toISOString(), // Supabase aceita ISO string (TIMESTAMPTZ)
          status: 'marcado', // Valor default definido na tabela, mas podemos setar aqui também
        },
      ])
      .select() // Retorna o registro inserido
      .single(); // Espera um único registro

    if (insertError) {
      console.error('Erro ao inserir no Supabase:', insertError);
      return res.status(500).json({ error: 'Erro ao salvar o compromisso.', details: insertError.message });
    }

    // 6. Formatar Data de Confirmação
    const dataHoraFormatada = dayjs(dataHoraCompromisso)
                                .tz(defaultTimezone) // Garante que a formatação use o timezone correto
                                .format('DD/MM/YYYY [às] HH:mm');

    // 7. Retornar Confirmação
    return res.status(200).json({
      confirmacao: `Compromisso "${insertData.titulo}" agendado para ${dataHoraFormatada}.`,
      id: insertData.id, // Retorna o ID do compromisso criado
      titulo: insertData.titulo,
      data_hora: dataHoraFormatada // Retorna a data formatada
    });

  } catch (error) {
    // Captura erros gerais (ex: JSON inválido no body)
    console.error('Erro inesperado na API:', error);
    // Verifica se o erro é de sintaxe JSON
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
        return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
    }
    return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
  }
}