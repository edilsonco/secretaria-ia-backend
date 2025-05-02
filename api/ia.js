import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// --- inicializações ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- funções que o GPT pode chamar ---
const functions = [
  {
    name: 'marcar',
    description: 'Marca um novo compromisso',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        data:   { type: 'string', description:'AAAA-MM-DD' },
        hora:   { type: 'string', description:'HH:MM (24h)' }
      },
      required: ['titulo','data','hora']
    }
  },
  {
    name: 'alterar',
    description: 'Altera um compromisso existente',
    parameters: {
      type: 'object',
      properties: {
        id:        { type:'string' },
        novo_titulo:{ type:'string' },
        nova_data: { type:'string' },
        nova_hora: { type:'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'cancelar',
    description: 'Cancela um compromisso',
    parameters: {
      type: 'object',
      properties: { id:{type:'string'} },
      required: ['id']
    }
  },
  {
    name: 'listar',
    description: 'Lista compromissos futuros',
    parameters: { type:'object',properties:{} }
  }
];

// --- handler da rota ---
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end('Método não permitido');

  const { mensagem } = req.body;
  if (!mensagem) return res.status(400).json({ erro:'Mensagem ausente' });

  // mensagem de sistema + usuário
  const mensagens = [
    { role:'system', content:'Você é uma secretária virtual. Use apenas as funções disponíveis.' },
    { role:'user',   content: mensagem }
  ];

  // chamada ao GPT
  const gpt = await openai.chat.completions.create({
    model:'gpt-3.5-turbo-0613',
    messages: mensagens,
    functions,
    function_call:'auto',
    temperature:0.2
  });

  const escolha = gpt.choices[0].message;

  // se o GPT NÃO chamou função, devolve texto simples
  if (!escolha.function_call) {
    return res.status(200).json({ resposta: escolha.content });
  }

  // --- execução da função solicitada ---
  const { name, arguments: argsJSON } = escolha.function_call;
  const args = JSON.parse(argsJSON);
  let resposta = '';

  try {
    if (name === 'marcar') {
      const ts = new Date(`${args.data}T${args.hora}:00`);
      await supabase.from('appointments').insert({
        titulo: args.titulo,
        data_hora: ts,
        status: 'marcado'
      });
      resposta = `Compromisso "${args.titulo}" marcado para ${ts.toLocaleString('pt-BR')}.`;
    }

    if (name === 'alterar') {
      const update = {};
      if (args.novo_titulo) update.titulo = args.novo_titulo;
      if (args.nova_data && args.nova_hora)
        update.data_hora = new Date(`${args.nova_data}T${args.nova_hora}:00`);
      await supabase.from('appointments').update(update).eq('id', args.id);
      resposta = 'Compromisso atualizado com sucesso.';
    }

    if (name === 'cancelar') {
      await supabase.from('appointments')
        .update({ status:'cancelado' })
        .eq('id', args.id);
      resposta = 'Compromisso cancelado.';
    }

    if (name === 'listar') {
      const { data } = await supabase
        .from('appointments')
        .select('*')
        .eq('status','marcado')
        .gte('data_hora', new Date().toISOString())
        .order('data_hora',{ascending:true});
      resposta = data.length
        ? data.map(c => `• ${c.titulo} em ${new Date(c.data_hora).toLocaleString('pt-BR')}`).join('\\n')
        : 'Você não tem compromissos futuros.';
    }

    return res.status(200).json({ resposta });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro:'Falha no banco', detalhes:e.message });
  }
}
