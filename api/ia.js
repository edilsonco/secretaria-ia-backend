import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { mensagem, conversa_id = 'default' } = req.body;
  if (!mensagem) return res.status(400).json({ erro: 'Mensagem não fornecida' });

  try {
    await supabase.from('mensagens').insert({ conversa_id, papel: 'user', conteudo: mensagem });

    const mensagemLower = mensagem.toLowerCase();
    const sinonimosDesmarcar = ['desmarcar', 'cancele', 'cancelar', 'remover', 'remova', 'excluir', 'exclua', 'desmarca'];
    const sinonimosEditar = ['editar', 'mudar', 'modificar', 'alterar', 'trocar', 'edite', 'mude', 'modifique', 'altere', 'troque'];
    const sinonimosMarcar = ['marcar', 'agendar', 'agende', 'marque', 'reserve'];

    const { data: compromissos } = await supabase.from('compromissos').select('*').order('id', { ascending: true });

    // DESMARCAR
    for (const palavra of sinonimosDesmarcar) {
      if (mensagemLower.includes(palavra)) {
        for (const compromisso of compromissos) {
          if (mensagemLower.includes(compromisso.nome?.toLowerCase())) {
            await supabase.from('compromissos').delete().eq('id', compromisso.id);
            const resposta = `O compromisso com ${compromisso.nome} foi desmarcado com sucesso.`;
            await supabase.from('mensagens').insert({ conversa_id, papel: 'assistant', conteudo: resposta });
            return res.status(200).json({ resposta });
          }
        }
      }
    }

    // ALTERAR (remove compromisso antigo)
    for (const palavra of sinonimosEditar) {
      if (mensagemLower.includes(palavra)) {
        for (const compromisso of compromissos) {
          if (mensagemLower.includes(compromisso.nome?.toLowerCase())) {
            await supabase.from('compromissos').delete().eq('id', compromisso.id);
            break;
          }
        }
      }
    }

    // HISTÓRICO para IA
    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = historico.map((msg) => ({ role: msg.papel, content: msg.conteudo }));

    contexto.unshift({
      role: 'system',
      content:
        'Você é uma secretária virtual. Sua função é marcar, desmarcar e alterar compromissos reais do usuário. Seja clara e objetiva. Com base na instrução do usuário, você responderá apenas o necessário.',
    });

    const listaCompromissos = compromissos.map((c) => `• ${c.nome} - ${c.data} às ${c.hora}`).join('\n') || 'Nenhum compromisso marcado.';
    contexto.unshift({
      role: 'system',
      content: `Compromissos atuais:\n${listaCompromissos}`,
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
        messages: contexto,
      }),
    });

    const data = await respostaIA.json();
    if (respostaIA.status !== 200) {
      return res.status(500).json({ erro: 'Erro da OpenAI', detalhes: data });
    }

    const respostaTexto = data.choices[0].message.content;
    await supabase.from('mensagens').insert({ conversa_id, papel: 'assistant', conteudo: respostaTexto });

    // MARCAR
    for (const palavra of sinonimosMarcar) {
      if (mensagemLower.includes(palavra)) {
        const nomeExtraido = mensagem.match(/com\s(\w+)/i)?.[1] || 'compromisso';
        const horaExtraida = mensagem.match(/(\d{1,2}h)/i)?.[1] || '00h';
        const dataExtraida = mensagem.match(/amanhã|segunda|terça|quarta|quinta|sexta|sábado|domingo|hoje/i)?.[0] || 'indefinida';

        await supabase.from('compromissos').insert({
          nome: nomeExtraido,
          data: dataExtraida,
          hora: horaExtraida,
          descricao: respostaTexto
        });

        break;
      }
    }

    res.status(200).json({ resposta: respostaTexto });
  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({ erro: 'Erro interno no servidor', detalhes: error.message });
  }
}
