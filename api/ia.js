import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem, conversa_id = 'default' } = req.body;
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    // 1. Salva a mensagem do usuário
    await supabase.from('mensagens').insert({
      conversa_id,
      papel: 'user',
      conteudo: mensagem
    });

    // 2. Busca histórico da conversa
    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = historico.map(msg => ({
      role: msg.papel,
      content: msg.conteudo
    }));

    // 3. Consulta compromissos marcados
    const { data: compromissosAtuais } = await supabase
      .from('appointments')
      .select('titulo, data_hora')
      .eq('status', 'marcado')
      .order('data_hora', { ascending: true });

    const listaCompromissos = compromissosAtuais
      .map(c => `• ${c.titulo} em ${new Date(c.data_hora).toLocaleString('pt-BR')}`)
      .join('\n') || 'Nenhum compromisso marcado.';

    contexto.unshift({
      role: 'system',
      content: `Lista atual de compromissos do usuário:\n${listaCompromissos}`
    });

    // 4. Prompt principal do sistema
    contexto.unshift({
      role: 'system',
      content:
        'Você é uma secretária virtual. Sua função é marcar, alterar e desmarcar compromissos reais do usuário, armazenados em um banco de dados. Use clareza e objetividade. Só fale o que tiver certeza com base na memória e compromissos existentes.'
    });

    // 5. Envia requisição para a OpenAI
    const respostaIA = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        temperature: 0.5,
        messages: contexto
      })
    });

    const data = await respostaIA.json();
    if (respostaIA.status !== 200) {
      return res.status(500).json({ erro: 'Erro da OpenAI', detalhes: data });
    }

    const respostaTexto = data.choices[0].message.content;

    // 6. Salva a resposta da IA
    await supabase.from('mensagens').insert({
      conversa_id,
      papel: 'assistant',
      conteudo: respostaTexto
    });

    // 7. Lógica de marcar, alterar ou desmarcar
    const texto = respostaTexto.toLowerCase();

    if (texto.includes('marquei') || texto.includes('agendei')) {
      const tituloMatch = respostaTexto.match(/reuni[aã]o.*?(com\s+\w+)?/i);
      const dataHora = new Date(); // Substitua com lógica real se necessário
      const titulo = tituloMatch ? tituloMatch[0] : 'Compromisso';

      await supabase.from('appointments').insert({
        titulo,
        data_hora: dataHora
      });
    }

    if (['desmarquei', 'cancelei', 'removi'].some(palavra => texto.includes(palavra))) {
      await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .eq('status', 'marcado')
        .order('data_hora', { ascending: false })
        .limit(1);
    }

    if (['altere', 'mudei', 'modifiquei', 'mude', 'modifique'].some(palavra => texto.includes(palavra))) {
      const novoHorario = new Date(); // Substitua por lógica extraída da resposta se quiser
      await supabase
        .from('appointments')
        .update({ data_hora: novoHorario })
        .eq('status', 'marcado')
        .order('data_hora', { ascending: false })
        .limit(1);
    }

    res.status(200).json({ resposta: respostaTexto });
  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({ erro: 'Erro interno no servidor', detalhes: error.message });
  }
}
