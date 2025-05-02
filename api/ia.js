import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------- Utilidades ---------- */
function parseDateTime(texto) {
  // Data opcional + hora obrigatória
  // Exemplos válidos: 05/05/2025 18h | 2025-05-05 às 18:00 | 18h | 18:30
  const dataRE = /(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/;
  const horaRE = /(\d{1,2})(?::|h)?(\d{2})?/;
  const dataM = texto.match(dataRE);
  const horaM = texto.match(horaRE);

  if (!horaM) return null;                     // precisamos de hora

  const [ , hh, mmRaw ] = horaM;
  const mm = mmRaw ?? '00';
  const horaISO = `${hh.padStart(2,'0')}:${mm.padEnd(2,'0')}:00`;

  let iso;
  if (dataM) {
    const d = dataM[1];
    const [ano, mes, dia] = d.includes('-') ? d.split('-') : d.split('/').reverse();
    iso = `${ano}-${mes}-${dia}T${horaISO}`;
  } else {
    // sem data -> hoje
    const hoje = new Date().toISOString().slice(0,10);
    iso = `${hoje}T${horaISO}`;
  }
  return iso;
}

function pessoaDoTexto(txt) {
  const m = txt.match(/com ([\p{L}\s]+)/iu);
  return m ? m[1].trim() : null;
}

function tituloCompromisso(txt) {
  const nome = pessoaDoTexto(txt) ?? 'Contato';
  return `Reunião com ${nome}`;
}

/* ---------- Verbos ---------- */
const verbsMarcar  = ['marque','marcar','marca','agende','agendar','agenda'];
const verbsCancelar= ['desmarque','desmarcar','cancele','cancelar','cancela'];
const verbsAlterar = ['altere','alterar','mude','muda','editar','edite','troque','troca'];

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST')     return res.status(405).json({erro:'Método não permitido'});
  const { mensagem } = req.body ?? {};
  if (!mensagem) return res.status(400).json({erro:'Mensagem não fornecida'});

  const txt = mensagem.toLowerCase();

  /* ----- MARCAR ----- */
  if (verbsMarcar.some(v=>txt.includes(v))){
    const dataISO = parseDateTime(txt);
    const nome    = tituloCompromisso(txt);
    await supabase.from('appointments').insert({
      titulo: nome,
      data_hora: dataISO,
      status: 'marcado'
    });
    return res.json({resposta:`Compromisso "${nome}" marcado para ${new Date(dataISO).toLocaleString('pt-BR')}.`});
  }

  /* ----- CANCELAR ----- */
  if (verbsCancelar.some(v=>txt.includes(v))){
    const pessoa = pessoaDoTexto(txt);
    if (!pessoa) return res.json({resposta:'Não consegui identificar qual compromisso cancelar.'});
    await supabase
      .from('appointments')
      .update({status:'cancelado'})
      .ilike('titulo', `%${pessoa}%`);
    return res.json({resposta:`Compromisso relacionado a ${pessoa} cancelado.`});
  }

  /* ----- ALTERAR ----- */
  if (verbsAlterar.some(v=>txt.includes(v))){
    const pessoa = pessoaDoTexto(txt);
    const novaISO = parseDateTime(txt);
    if (!pessoa || !novaISO)
      return res.json({resposta:'Informe quem e nova data/hora.'});

    await supabase
      .from('appointments')
      .update({data_hora:novaISO, status:'remarcado'})
      .ilike('titulo', `%${pessoa}%`);

    return res.json({resposta:`Compromisso com ${pessoa} remarcado para ${new Date(novaISO).toLocaleString('pt-BR')}.`});
  }

  /* ----- LISTAR ----- */
  const { data: rows } = await supabase
    .from('appointments')
    .select('*')
    .eq('status','marcado')
    .order('data_hora');

  if (!rows.length) return res.json({resposta:'Você não tem compromissos marcados.'});

  const lista = rows.map(r=>`• ${r.titulo} @ ${new Date(r.data_hora).toLocaleString('pt-BR')}`).join('\n');
  return res.json({resposta:`Lista atual de compromissos:\n${lista}`});
}
