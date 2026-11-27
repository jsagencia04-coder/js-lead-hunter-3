import { jsPDF } from 'jspdf'
/** PDF de texto real, sem upload externo e sem exigir impressão do navegador. */
export function createTextPdf(title:string,sections:{heading:string;text:string}[],footer='JS Designer · documento gerado a partir dos registros disponíveis'){
 const doc=new jsPDF();let y=22
 const line=(text:string,size=10)=>{doc.setFontSize(size);const chunks=doc.splitTextToSize(text||'Não informado',174) as string[];for(const chunk of chunks){if(y>276){doc.addPage();y=22}doc.text(chunk,18,y);y+=size*0.45+2}}
 line(title,18);y+=6
 for(const section of sections){line(section.heading,12);line(section.text);y+=5}
 const count=doc.getNumberOfPages();for(let i=1;i<=count;i++){doc.setPage(i);doc.setFontSize(8);doc.text(`${footer} · ${i}/${count}`,18,289,{maxWidth:174})}
 return doc
}
