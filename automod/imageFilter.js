const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i;

export function isDirectImageUrl(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && IMAGE_EXT.test(url.pathname + url.search); }
  catch { return false; }
}

export function detectImage(message) {
  for (const attachment of message.attachments?.values?.() ?? []) {
    if (attachment.contentType?.startsWith('image/') || IMAGE_EXT.test(attachment.name ?? attachment.url ?? '')) return { name: attachment.name || attachment.url };
  }
  const urls = String(message.content ?? '').match(/https?:\/\/[^\s<>]+/gi) ?? [];
  const direct = urls.find(isDirectImageUrl);
  if (direct) return { name: direct };
  for (const embed of message.embeds ?? []) {
    const candidate = embed.image?.url || embed.thumbnail?.url;
    if (candidate && (isDirectImageUrl(candidate) || urls.includes(candidate))) return { name: candidate };
  }
  return null;
}
