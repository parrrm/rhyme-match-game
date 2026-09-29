// Ignore surrounding punctuation while preserving punctuation within a word.
function normalizeWord(value){
  return String(value ?? '').trim().toUpperCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export { normalizeWord };
