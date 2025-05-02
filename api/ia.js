import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const functions = [
  {
    name: 'marcar',
    description: 'Marca um novo compromisso',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título do compromisso' },
        data:   { type: 'string', description: 'Data YYYY-MM-DD' },
        hora:   { type: 'string', description: 'Hora HH:MM (24h)' }
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
        id:       { type: 'string', description: 'ID do compromisso a alterar' },
        novo_titulo:{ type:'string' },
        nova_data:  { type:'string' },
        nova_hora:  { type:'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'cancelar',
    description: 'Cancela um compromisso',
    parameters: {
      type: 'object',
      properties: {
        id:     { type:'string',description:'ID do compromisso' },
        titulo: { type:'string',description:'Título, caso não saiba o ID' }
      }
    }
  },
  {
    name: 'listar',
    description: 'Lista compromissos futuros',
    parameters:{ type:'object', properties:{} }
  }
];

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST')    return res.status(405).end();

  const { mensagem } = req.body;
  if(!mensagem) return res.status(400).json({erro:'Mensagem não fornecida'});

  // monta mensagens
  const system = { role:'system',content:
    'Você é uma secretária virtual. Use APENAS as funções fornecidas. '
  };
  const userMsg = { role:'user',content: mensagem };

  // chama OpenAI
  const resp = await openai.chat.completions.create({
    model:'gpt-3.5-turbo-0613',
    messages:[system,userMsg],
    functions,
    function_call:'auto',
    temperature:0.2
  });

  const choice = resp.choices[0].message;

  // se modelo NÃO chamou função => apenas devolver a resposta direta
  if(!choice.function_call){
    return res.status(200).json({resposta: choice.content});
  }

  // houve chamada de função
  const { name, arguments: argsJSON } = choice.function_call;
  const args = JSON.parse(argsJSON);

  let respostaUsuario = '';

  try{
    if(name==='marcar'){
      const ts = new Date(`${args.data}T${args.hora}:00`);
      await supabase.from('appointments').insert({
        titulo: args.titulo,
        data_hora: ts,
        status:'marcado'
      });
      respostaUsuario = `Compromisso "${args.titulo}" marcado para ${ts.toLocaleString('pt-BR')}.`;
    }

    if(name==='alterar'){
      const update = {};
      if(args.novo_titulo) update.titulo = args.novo_titulo;
      if(args.nova_data && args.nova_hora){
        update.data_hora = new Date(`${args.nova_data}T${args.nova_hora}:00`);
      }
      const { error } = await supabase
        .from('appointments')
        .update(update)
        .eq('id', args.id);
      if(error) throw error;
      respostaUsuario = 'Compromisso atualizado com sucesso.';
    }

    if(name==='cancelar'){
      const ref = args.id
        ? supabase.from('appointments').update({status:'cancelado'}).eq('id',args.id)
        : supabase.from('appointments').update({status:'cancelado'}).ilike('titulo',`%${args.titulo}%`);
      const { error } = await ref;
      if(error) throw error;
      respostaUsuario = 'Compromisso cancelado.';
    }

    if(name==='listar'){
      const { data } = await supabase
        .from('appointments')
        .select('*')
        .eq('status','marcado')
        .gte('data_hora', new Date().toISOString())
        .order('data_hora',{ascending:true});

      if(!data.length) respostaUsuario = 'Você não tem compromissos futuros.';
      else {
        respostaUsuario = data.map(c =>
          `• ${c.titulo} em ${new Date(c.data_hora).toLocaleString('pt-BR')}`
        ).join('\\n');
      }
    }
  }catch(e){
    console.error(e);
    return res.status(500).json({erro:'Falha ao acessar banco',detalhes:e.message});
  }

  // envia resposta final ao usuário
  return res.status(200).json({resposta: respostaUsuario});
}
