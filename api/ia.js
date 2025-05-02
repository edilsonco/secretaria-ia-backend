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
    // Salvar mensagem do usuário na memória
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
          if (mensagemLower.includes(compromisso.resposta_gerada.toLowerCase())) {
            await supabase.from('compromissos').delete().eq('id', compromisso.id);
            const resposta = `O compromisso foi desmarcado com sucesso.`;
            await supabase.from('mensagens').insert({ conversa_id, papel: 'assistant', conteudo: resposta });
            return res.status(200).json({ resposta });
          }
        }
      }
    }

    // ALTERAR (remove o compromisso antigo)
    for (const palavra of sinonimosEditar) {
      if (mensagemLower.includes(palavra)) {
        for (const compromisso of compromissos) {
          if (mensagemLower.includes(compromisso.resposta_gerada.toLowerCase())) {
            await supabase.from('compromissos').delete().eq('id', compromisso.id);
            break;
          }
        }
      }
    }

    // HISTÓRICO para contexto da IA
    const { data: historico } = await supabase
      .from('mensagens')
      .select('papel, conteudo')
      .eq('conversa_id', conversa_id)
      .order('criado_em', { ascending: true })
      .limit(10);

    const contexto = historico.map((msg) => ({ role: msg.papel, content: msg.conteudo }));

    // Prompt de sistema
    contexto.unshift({
      role: 'system',
      content:
        'Você é uma secretária virtual. Sua função é ajudar a marcar, alterar e desmarcar compromissos reais do usuário, que ficam armazenados em um banco de dados. Seja clara, objetiva e só fale o que tiver certeza com base na memória. Se não souber, diga que não sabe.',
    });

    // Lista atual de compromissos
    const listaCompromissos = compromissos.map((c) => `• ${c.resposta_gerada}`).join('\n') || 'Nenhum compromisso marcado.';
    contexto.unshift({
      role: 'system',
      content: `Lista atual de compromissos do usuário:\n${listaCompromissos}`,
    });

    // Chamada OpenAI
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

    // Salvar resposta da IA
    await supabase.from('mensagens').insert({ conversa_id, papel: 'assistant', conteudo: respostaTexto });

    // MARCAR compromisso
    for (const palavra of sinonimosMarcar) {
      if (mensagemLower.includes(palavra)) {
        await supabase.from('compromissos').insert({ mensagem_original: mensagem, resposta_gerada: respostaTexto });
        break;
      }
    }

    res.status(200).json({ resposta: respostaTexto });
  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({ erro: 'Erro interno no servidor', detalhes: error.message });
  }
}
