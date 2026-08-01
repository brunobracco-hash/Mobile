/** Um nome de arquivo raramente é um bom título, mas é o que quase sempre há. */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.pdf$/i, '');
  const cleaned = withoutExtension
    .replace(/[_+]+/g, ' ')
    // Hífen entre palavras costuma ser separador do nome do arquivo, não do texto.
    .replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : 'Documento sem título';
}
