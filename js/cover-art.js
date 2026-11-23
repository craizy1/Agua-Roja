/* ==========================================================================
   COVER ART ENGINE — HUGGING FACE FREE MODELS + VINTAGE VINYL SLEEVE FALLBACK
   Supports Hugging Face Router Serverless Inference API for free open-weights
   text-to-image models, plus an instant offline Canvas vintage vinyl art studio.
   ========================================================================== */

export const HF_FREE_COVER_MODELS = [
  {
    id: 'black-forest-labs/FLUX.1-schnell',
    label: 'FLUX.1 [schnell] — Rápido y fotográfico (Apache 2.0)',
    endpoint: 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
  },
  {
    id: 'stabilityai/stable-diffusion-xl-base-1.0',
    label: 'SDXL 1.0 Base — Texturas analógicas y arte editorial',
    endpoint: 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0',
  },
  {
    id: 'black-forest-labs/FLUX.1-dev',
    label: 'FLUX.1 [dev] — Máximo detalle artístico',
    endpoint: 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-dev',
  },
];

/**
 * Craft an art-directed vintage vinyl sleeve prompt for Hugging Face models.
 */
export function buildVintageCoverPrompt({ title, artist, genre, moodPrompt }) {
  const cleanGenre = (genre || 'Analog Soul & Jazz').trim();
  const customMood = (moodPrompt || '').trim();
  const subject = customMood
    ? customMood
    : `abstract mid-century graphic art evoking "${title || 'Studio Session'}" in the style of ${cleanGenre}`;

  return [
    `Square vinyl album cover artwork, ${subject}.`,
    `Inspired by classic 1960s and 1970s Blue Note and ECM Records sleeve design,`,
    `warm walnut wood tones, burnt amber, deep espresso charcoal, cream paper grain texture,`,
    `analog photography lighting, subtle vintage print halftone, museum-grade minimalist composition,`,
    `no text, no words, no letters, no watermark.`,
  ].join(' ');
}

/**
 * Generate square cover art using Hugging Face's free Inference Router API.
 * Returns a Data URL (image/jpeg or image/png) ready to store in IndexedDB.
 */
export async function generateHuggingFaceCover({ token, modelId, prompt }) {
  const cleanToken = (token || '').trim();
  if (!cleanToken) {
    throw new Error('Ingresa tu token gratuito de Hugging Face para generar portadas con IA.');
  }

  const model = HF_FREE_COVER_MODELS.find((m) => m.id === modelId) || HF_FREE_COVER_MODELS[0];

  const response = await fetch(model.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      'Content-Type': 'application/json',
      Accept: 'image/png',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        width: 768,
        height: 768,
      },
    }),
  });

  if (!response.ok) {
    let errDetail = `${response.status}`;
    try {
      const txt = await response.text();
      errDetail = txt.slice(0, 220);
    } catch {}
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Token de Hugging Face rechazado (${response.status}). Verifica que tu token tenga permiso "Inference Providers" en huggingface.co/settings/tokens.`
      );
    }
    if (response.status === 503) {
      throw new Error('El modelo en Hugging Face está despertando (503). Intenta nuevamente en 15 segundos.');
    }
    throw new Error(`Error de Hugging Face (${response.status}): ${errDetail}`);
  }

  const blob = await response.blob();
  return blobToCompressedDataUrl(blob, 560);
}

/**
 * Resize/compress uploaded or HF-generated image into a crisp square JPEG Data URL
 * to keep IndexedDB metadata fast and lightweight.
 */
export function blobToCompressedDataUrl(blob, size = 560) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Center-crop square
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/**
 * Deterministic Mid-Century Vintage Vinyl Sleeve Art Generator (100% offline fallback).
 * Produces tactile, warm wooden/vinyl/cassette-era abstract album covers on Canvas.
 */
export function generateProceduralVintageCover(seedText = 'Analog Session', variantOffset = 0) {
  const size = 560;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Deterministic hash from seedText + variantOffset
  let hash = 2166136261 + variantOffset * 9973;
  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const nextRand = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return ((hash >>> 0) % 10000) / 10000;
  };

  // Curated 1960s-70s audiophile vinyl palettes (Walnut, Oxblood, Ochre, Sage, Cream, Espresso)
  const palettes = [
    { bg: '#221710', a: '#D4953F', b: '#C45A3B', c: '#F2E7D3', d: '#4B3222' },
    { bg: '#1B1D18', a: '#E6B05C', b: '#739460', c: '#EFE3CE', d: '#3B2C1F' },
    { bg: '#2A1814', a: '#DF8B44', b: '#9E3E2A', c: '#F3E8D4', d: '#5B3A29' },
    { bg: '#1D1815', a: '#C89242', b: '#5E6F64', c: '#E7D8BE', d: '#3A281C' },
    { bg: '#261C14', a: '#E09D48', b: '#B85438', c: '#F4EBD9', d: '#6E5035' },
  ];
  const pal = palettes[Math.floor(nextRand() * palettes.length)];

  // Base matte paper background
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, size, size);

  // Subtle radial warm studio spotlight
  const grad = ctx.createRadialGradient(size * 0.35, size * 0.3, 20, size * 0.5, size * 0.5, size * 0.8);
  grad.addColorStop(0, 'rgba(255, 232, 190, 0.14)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const motif = Math.floor(nextRand() * 3);

  if (motif === 0) {
    // Motif 1: Concentric vinyl & acoustic wave arcs (Blue Note modernist vibe)
    const cx = size * (0.42 + nextRand() * 0.16);
    const cy = size * (0.42 + nextRand() * 0.16);
    ctx.fillStyle = pal.d;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = pal.b;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = pal.c;
    ctx.lineWidth = 3;
    for (let r = 64; r < 245; r += 22) {
      ctx.globalAlpha = 0.22 + (r / 300) * 0.28;
      ctx.beginPath();
      ctx.arc(cx, cy, r, nextRand() * 1.2, Math.PI * 1.4 + nextRand());
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = pal.a;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fill();
  } else if (motif === 1) {
    // Motif 2: Analog Reel-to-Reel Tape Geometry
    ctx.fillStyle = pal.d;
    ctx.fillRect(42, 42, size - 84, size - 84);

    // Dual tape reels
    const drawReel = (rx, ry, radius, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(rx, ry, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 8;
      for (let k = 0; k < 3; k++) {
        const ang = (k * Math.PI * 2) / 3 + 0.3;
        ctx.beginPath();
        ctx.moveTo(rx + Math.cos(ang) * 24, ry + Math.sin(ang) * 24);
        ctx.lineTo(rx + Math.cos(ang) * (radius - 16), ry + Math.sin(ang) * (radius - 16));
        ctx.stroke();
      }
      ctx.fillStyle = pal.c;
      ctx.beginPath();
      ctx.arc(rx, ry, 20, 0, Math.PI * 2);
      ctx.fill();
    };

    drawReel(size * 0.33, size * 0.42, 112, pal.a);
    drawReel(size * 0.68, size * 0.58, 94, pal.b);

    // Tape path line
    ctx.strokeStyle = pal.c;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(size * 0.14, size * 0.78);
    ctx.lineTo(size * 0.86, size * 0.78);
    ctx.stroke();
  } else {
    // Motif 3: Mid-century Swiss / Cassette stripes & acoustic horizon
    const stripes = 7;
    const stripeH = 38;
    for (let s = 0; s < stripes; s++) {
      ctx.fillStyle = s % 3 === 0 ? pal.a : s % 3 === 1 ? pal.b : pal.c;
      ctx.globalAlpha = 0.88 - s * 0.06;
      ctx.fillRect(48, 72 + s * (stripeH + 12), size - 96 - s * 18, stripeH);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = pal.bg;
    ctx.beginPath();
    ctx.arc(size * 0.72, size * 0.66, 98, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.a;
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  // Subtle vintage vinyl ring wear & paper grain
  ctx.strokeStyle = 'rgba(243, 232, 212, 0.12)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.455, 0, Math.PI * 2);
  ctx.stroke();

  // Tactile grain dots
  ctx.fillStyle = 'rgba(255, 244, 224, 0.05)';
  for (let i = 0; i < 900; i++) {
    ctx.fillRect(nextRand() * size, nextRand() * size, 2, 2);
  }

  // Outer studio sleeve frame line
  ctx.strokeStyle = 'rgba(212, 149, 63, 0.38)';
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, size - 36, size - 36);

  return canvas.toDataURL('image/jpeg', 0.9);
}
