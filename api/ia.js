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
    await supabase.from('mensagens').insert({ conversa_id, papel: 'user', conteudo: mensagem });

    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = historico.map((msg) => ({ role: msg.papel, content: msg.conteudo }));

    contexto.unshift({
      role: 'system',
      content: 'Você é uma secretária virtual. Sua função é marcar, desmarcar e alterar compromissos reais do usuário com base em um banco de dados. Responda com clareza, não invente dados, e confirme apenas compromissos reais.'
    });

    const { data: compromissos } = await supabase.from('appointments').select('*').order('created_at', { ascending: true });
    const lista = compromissos.map(c => `• ${c.titulo} em ${new Date(c.data_hora).toLocaleString('pt-BR')}`).join('\n') || 'Nenhum compromisso encontrado.';

    contexto.unshift({
      role: 'system',
      content: `Agenda atual:
${lista}`
    });

    const respostaIA = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
    await supabase.from('mensagens').insert({ conversa_id, papel: 'assistant', conteudo: respostaTexto });

    const msg = mensagem.toLowerCase();

    // Inserção
    if (msg.includes('marque') || msg.includes('agende') || msg.includes('marcar')) {
      const titulo = mensagem;
      const data_hora = new Date(); // Placeholder para melhoria futura
      await supabase.from('appointments').insert({ titulo, data_hora });
    }

    // Desmarcar
    if (msg.includes('desmarque') || msg.includes('desmarcar') || msg.includes('cancele') || msg.includes('remova')) {
      const termos = ['desmarque', 'desmarcar', 'cancele', 'remova'];
      const termoEncontrado = termos.find(t => msg.includes(t));
      if (termoEncontrado) {
        const palavras = mensagem.split(' ');
        const nome = palavras.find(p => /^[A-ZÁÉÍÓÚ][a-záéíóú]+$/.test(p)) || '';
        await supabase.from('appointments').delete().ilike('titulo', `%${nome}%`);
      }
    }

    // Alterar horário
    if (msg.includes('altere') || msg.includes('mude') || msg.includes('editar') || msg.includes('edite') || msg.includes('modifique')) {
      const nome = mensagem.match(/com\s+(\w+)/i)?.[1];
      const novaHora = mensagem.match(/para\s+(\d{1,2}h)/i)?.[1];
      if (nome && novaHora) {
        const novoTimestamp = new Date(); // Placeholder
        await supabase.from('appointments').update({ data_hora: novoTimestamp }).ilike('titulo', `%${nome}%`);
      }
    }

    res.status(200).json({ resposta: respostaTexto });
  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({ erro: 'Erro interno no servidor', detalhes: error.message });
  }
}
