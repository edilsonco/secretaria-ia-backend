import * as chrono from 'chrono-node';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// Configurar dayjs para usar timezone
dayjs.extend(utc);
dayjs.extend(timezone);

// Definir timezone do Brasil
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo';

// Configurar cliente Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Verificar se as variáveis de ambiente estão definidas
if (!supabaseUrl || !supabaseKey) {
  console.error('Variáveis de ambiente SUPABASE_URL e SUPABASE_KEY são obrigatórias');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Função auxiliar para analisar datas em português
function parseDatePtBr(texto) {
  // Substituir palavras-chave em português por equivalentes em inglês para melhor compatibilidade
  const textoProcessado = texto
    .replace(/\bhoje\b/gi, 'today')
    .replace(/\bamanhã\b/gi, 'tomorrow')
    .replace(/\bontem\b/gi, 'yesterday')
    .replace(/\bsegunda[\s-]feira\b/gi, 'Monday')
    .replace(/\bterça[\s-]feira\b/gi, 'Tuesday')
    .replace(/\bquarta[\s-]feira\b/gi, 'Wednesday')
    .replace(/\bquinta[\s-]feira\b/gi, 'Thursday')
    .replace(/\bsexta[\s-]feira\b/gi, 'Friday')
    .replace(/\bsábado\b/gi, 'Saturday')
    .replace(/\bdomingo\b/gi, 'Sunday')
    .replace(/\bàs\b/gi, 'at')
    .replace(/\bao meio-dia\b/gi, 'at noon')
    .replace(/\bà meia-noite\b/gi, 'at midnight')
    .replace(/\bpróxima\b/gi, 'next')
    .replace(/\bpróximo\b/gi, 'next');
  
  // Tentar analisar com o texto processado
  let resultados = chrono.parse(textoProcessado);
  
  // Se não encontrou resultados, tentar com o texto original
  if (resultados.length === 0) {
    resultados = chrono.parse(texto);
  }
  
  return resultados;
}

export default async function handler(req, res) {
  // Verificar se é uma requisição POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { mensagem } = req.body;

    if (!mensagem) {
      return res.status(400).json({ error: 'O campo "mensagem" é obrigatório' });
    }

    // Usar função auxiliar para analisar a data/hora na mensagem
    const resultados = parseDatePtBr(mensagem);

    if (resultados.length === 0) {
      return res.status(400).json({ error: 'Não foi possível identificar uma data/hora na mensagem' });
    }

    // Obter a data analisada
    const dataParsed = resultados[0].start.date();
    
    // Formatar com dayjs usando o timezone correto
    const dataFormatada = dayjs(dataParsed).tz(TIMEZONE);
    
    // Extrair título removendo a parte de data/hora e verbos de ação
    let titulo = mensagem;
    
    // Remover a parte de data/hora que foi detectada
    titulo = titulo.replace(resultados[0].text, '').trim();
    
    // Remover verbos comuns no início
    const verbosComuns = ['marque', 'agende', 'criar', 'crie', 'organizar', 'organize', 'marcar', 'agendar'];
    for (const verbo of verbosComuns) {
      if (titulo.toLowerCase().startsWith(verbo + ' ')) {
        titulo = titulo.substring(verbo.length).trim();
        break;
      }
    }
    
    // Se o título termina com preposições ou conectores, removê-los
    const conectoresFinal = [' com', ' para', ' na', ' no', ' em'];
    for (const conector of conectoresFinal) {
      if (titulo.toLowerCase().endsWith(conector)) {
        titulo = titulo.substring(0, titulo.length - conector.length).trim();
      }
    }
    
    // Inserir no Supabase
    const { data, error } = await supabase
      .from('appointments')
      .insert([
        { 
          titulo: titulo, 
          data_hora: dataFormatada.toISOString(), 
          status: 'marcado' 
        }
      ])
      .select();

    if (error) {
      console.error('Erro ao inserir no Supabase:', error);
      return res.status(500).json({ error: 'Erro ao salvar compromisso no banco de dados' });
    }

    // Formatar data para a resposta (DD/MM/YYYY às HH:mm)
    const dataFormatadaTexto = dataFormatada.format('DD/MM/YYYY [às] HH:mm');

    // Enviar resposta
    return res.status(200).json({
      sucesso: true,
      mensagem: `Compromisso "${titulo}" agendado para ${dataFormatadaTexto}`,
      compromisso: data[0]
    });

  } catch (error) {
    console.error('Erro no processamento:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
