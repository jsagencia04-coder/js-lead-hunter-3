export function classifyCommercialQuestion(input:string):string|null{
 const text=input.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
 if(/\b(sql|drop|truncate|delete|insert|update|alter)\b/.test(text))return null
 if(/sem responsavel|nao atribuid/.test(text))return'unassigned'
 if(/proposta|negociacao/.test(text))return'proposals'
 if(/follow.?up|atrasad|tarefa|reuniao|agenda/.test(text))return'followups'
 if(/mudou|mudaram|mudanca|alteracao|radar/.test(text))return'changes'
 if(/sem site|nao.*site|site.*nao localizado/.test(text))return'site_gaps'
 if(/prioriz|abordar|hoje|prioritari|oportunidade/.test(text))return'priorities'
 return null
}
