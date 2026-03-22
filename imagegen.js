// Генерация изображений через Pollinations.ai (бесплатно, без ключа)

async function generateImage(prompt) {
  const encoded = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;

  const res = await fetch(url, { redirect: 'follow' });

  if (!res.ok) {
    throw new Error(`Pollinations ${res.status}: ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (buffer.length < 1000) {
    throw new Error('Pollinations вернул слишком маленький ответ');
  }

  return buffer;
}

module.exports = { generateImage };
