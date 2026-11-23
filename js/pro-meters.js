/* ==========================================================================
   AGUJA ROJA — PANEL PRO (MINIMETERS-INSPIRED MASTERING ANALYZER SUITE)
   1. Scrolling Logarithmic 20 Hz – 20,000 Hz Waterfall Spectrogram
      (with live MIX <-> MASTER event marker lines!)
   2. Stereo Phase Correlation Meter (-1 .. 0 .. +1)
   3. Phosphor-Trail Lissajous Stereo Vectorscope / Goniometer (L/R/M/S)
   4. Live Oscilloscope / Transient Scope (compare limiting vs dynamics)
   ========================================================================== */

function fitHiDpi(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// Vintage thermal heatmap LUT (256 RGB colors): Obsidian -> Walnut -> Aguja Roja Crimson -> Brass -> Ivory
const HEAT_LUT = new Uint8ClampedArray(256 * 3);
(function buildHeatmapLut() {
  const stops = [
    { at: 0.0, r: 14, g: 11, b: 9 },      // Deep espresso silence
    { at: 0.22, r: 46, g: 24, b: 16 },    // Dark walnut
    { at: 0.48, r: 158, g: 46, b: 32 },   // Aguja Roja crimson
    { at: 0.74, r: 222, g: 148, b: 56 },  // Brushed brass / amber
    { at: 0.92, r: 247, g: 222, b: 168 }, // Warm parchment tungsten
    { at: 1.0, r: 255, g: 250, b: 238 },  // Peak ivory
  ];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k].at && t <= stops[k + 1].at) {
        s0 = stops[k];
        s1 = stops[k + 1];
        break;
      }
    }
    const local = s1.at > s0.at ? (t - s0.at) / (s1.at - s0.at) : 0;
    HEAT_LUT[i * 3] = Math.round(s0.r + (s1.r - s0.r) * local);
    HEAT_LUT[i * 3 + 1] = Math.round(s0.g + (s1.g - s0.g) * local);
    HEAT_LUT[i * 3 + 2] = Math.round(s0.b + (s1.b - s0.b) * local);
  }
})();

export class ProMetersRenderer {
  constructor() {
    // Offscreen scrolling buffer for the 20Hz-20kHz Spectrogram
    this.specBuf = document.createElement('canvas');
    this.specBuf.width = 540;
    this.specBuf.height = 200;
    this.specCtx = this.specBuf.getContext('2d', { willReadFrequently: false });
    this.specCtx.fillStyle = '#0e0b09';
    this.specCtx.fillRect(0, 0, this.specBuf.width, this.specBuf.height);

    // Pending visual marker when user toggles MIX <-> MASTER
    this.pendingSwitchMarker = null;

    // Rolling peak history for MiniMeters-style Oscilloscope / Dynamics Ribbon
    this.scopeHistory = new Float32Array(260);
    this.scopePtr = 0;
  }

  markVersionSwitch(version) {
    this.pendingSwitchMarker = version; // 'mix' | 'master'
  }

  clearSpectrogram() {
    this.specCtx.fillStyle = '#0e0b09';
    this.specCtx.fillRect(0, 0, this.specBuf.width, this.specBuf.height);
    this.scopeHistory.fill(0);
  }

  /**
   * 1. Scrolling 20 Hz – 20,000 Hz Logarithmic Waterfall Spectrogram
   */
  drawSpectrogram(canvas, proFreqData, sampleRate = 48000, isPlaying = false) {
    const { ctx, w, h } = fitHiDpi(canvas);
    const labelColW = 46;
    const plotW = Math.max(10, w - labelColW);
    const minFreq = 20;
    const maxFreq = 20000;
    const logRange = Math.log(maxFreq / minFreq);

    // Scroll offscreen spectrogram left by 2px when playing
    if (isPlaying && proFreqData && proFreqData.length > 0) {
      const bw = this.specBuf.width;
      const bh = this.specBuf.height;
      const scrollPx = 2;

      this.specCtx.drawImage(this.specBuf, scrollPx, 0, bw - scrollPx, bh, 0, 0, bw - scrollPx, bh);

      const nyquist = sampleRate / 2;
      const binCount = proFreqData.length;
      const colImg = this.specCtx.createImageData(scrollPx, bh);
      const pixels = colImg.data;

      for (let y = 0; y < bh; y++) {
        // y=0 -> 20,000 Hz (top), y=bh-1 -> 20 Hz (bottom)
        const normY = 1 - y / (bh - 1);
        const freq = minFreq * Math.pow(maxFreq / minFreq, normY);
        const exactBin = (freq / nyquist) * (binCount - 1);
        const b0 = Math.max(0, Math.min(binCount - 1, Math.floor(exactBin)));
        const b1 = Math.min(binCount - 1, b0 + 1);
        const frac = exactBin - b0;
        const val = Math.round(proFreqData[b0] * (1 - frac) + proFreqData[b1] * frac);

        // Gentle gamma lift so subtle harmonic air (10k-20kHz) stays visible
        const boosted = Math.min(255, Math.round(Math.pow(val / 255, 0.85) * 255));
        const r = HEAT_LUT[boosted * 3];
        const g = HEAT_LUT[boosted * 3 + 1];
        const b = HEAT_LUT[boosted * 3 + 2];

        for (let px = 0; px < scrollPx; px++) {
          const idx = (y * scrollPx + px) * 4;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = 255;
        }
      }
      this.specCtx.putImageData(colImg, bw - scrollPx, 0);

      // Draw crisp vertical marker line whenever Mix <-> Master toggled
      if (this.pendingSwitchMarker) {
        this.specCtx.fillStyle =
          this.pendingSwitchMarker === 'master' ? 'rgba(235, 180, 95, 0.92)' : 'rgba(227, 113, 82, 0.92)';
        this.specCtx.fillRect(bw - scrollPx, 0, 2, bh);
        this.pendingSwitchMarker = null;
      }
    }

    // Paint background & blit spectrogram plot
    ctx.fillStyle = '#0e0b09';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.specBuf, labelColW, 0, plotW, h);

    // Frequency scale ticks (20 Hz to 20 kHz)
    const freqs = [
      { f: 20, lbl: '20 Hz' },
      { f: 60, lbl: '60' },
      { f: 120, lbl: '120' },
      { f: 250, lbl: '250' },
      { f: 500, lbl: '500' },
      { f: 1000, lbl: '1 k' },
      { f: 2000, lbl: '2 k' },
      { f: 4000, lbl: '4 k' },
      { f: 8000, lbl: '8 k' },
      { f: 16000, lbl: '16 k' },
      { f: 20000, lbl: '20 k' },
    ];

    ctx.fillStyle = '#15100d';
    ctx.fillRect(0, 0, labelColW, h);
    ctx.strokeStyle = 'rgba(232, 207, 170, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(labelColW + 0.5, 0);
    ctx.lineTo(labelColW + 0.5, h);
    ctx.stroke();

    ctx.font = '500 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (const item of freqs) {
      const normY = Math.log(item.f / minFreq) / logRange;
      const y = Math.max(7, Math.min(h - 7, (1 - normY) * h));

      ctx.strokeStyle = 'rgba(244, 235, 217, 0.1)';
      ctx.beginPath();
      ctx.moveTo(labelColW, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      ctx.fillStyle = item.f === 20 || item.f === 20000 ? '#ebb45f' : 'rgba(201, 183, 156, 0.78)';
      ctx.fillText(item.lbl, labelColW - 5, y);
    }

    if (!isPlaying) {
      ctx.fillStyle = 'rgba(244, 235, 217, 0.5)';
      ctx.font = '500 11px "DM Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pulsa Play para ver el espectrograma 20 Hz – 20 kHz en tiempo real', labelColW + plotW / 2, h / 2);
    }
  }

  /**
   * 2. Stereo Correlation Bar (-1 .. 0 .. +1)
   */
  drawCorrelation(canvas, correlation = 0) {
    const { ctx, w, h } = fitHiDpi(canvas);
    ctx.clearRect(0, 0, w, h);

    const padX = 14;
    const trackY = 18;
    const trackH = 14;
    const trackW = w - padX * 2;
    const midX = padX + trackW / 2;

    // Background track
    ctx.fillStyle = '#0f0c0a';
    ctx.beginPath();
    ctx.roundRect(padX, trackY, trackW, trackH, 4);
    ctx.fill();

    // Left red zone (-1 .. 0) tint & Right sage/brass safe zone (0 .. +1) tint
    ctx.fillStyle = 'rgba(198, 63, 44, 0.22)';
    ctx.fillRect(padX, trackY, trackW / 2, trackH);
    ctx.fillStyle = 'rgba(115, 148, 96, 0.22)';
    ctx.fillRect(midX, trackY, trackW / 2, trackH);

    // Active bar from center (0) toward correlation value
    const clamped = Math.max(-1, Math.min(1, correlation));
    const targetX = padX + ((clamped + 1) / 2) * trackW;
    const fillColor = clamped < 0 ? '#e04332' : clamped < 0.35 ? '#ebb45f' : '#90b57a';

    ctx.fillStyle = fillColor;
    if (clamped >= 0) {
      ctx.fillRect(midX, trackY + 2, targetX - midX, trackH - 4);
    } else {
      ctx.fillRect(targetX, trackY + 2, midX - targetX, trackH - 4);
    }

    // Center 0 tick & Needle marker
    ctx.strokeStyle = 'rgba(244, 235, 217, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(midX, trackY - 3);
    ctx.lineTo(midX, trackY + trackH + 3);
    ctx.stroke();

    // Aguja Roja indicator pin
    ctx.fillStyle = '#f4ebd9';
    ctx.fillRect(targetX - 1.5, trackY - 2, 3, trackH + 4);

    // Scale labels
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#e37152';
    ctx.textAlign = 'left';
    ctx.fillText('-1 (Fase -)', padX, 11);

    ctx.fillStyle = '#c9b79c';
    ctx.textAlign = 'center';
    ctx.fillText('0 (Estéreo)', midX, 11);

    ctx.fillStyle = '#90b57a';
    ctx.textAlign = 'right';
    ctx.fillText('+1 (Mono)', w - padX, 11);
  }

  /**
   * 3. Lissajous Stereo Vectorscope / Goniometer (Phosphor Trails)
   */
  drawVectorscope(canvas, timeDataL, timeDataR, activeVersion = 'master', isPlaying = false) {
    const { ctx, w, h } = fitHiDpi(canvas);

    // Phosphor decay trail instead of harsh clear
    ctx.fillStyle = 'rgba(14, 11, 9, 0.36)';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.43;

    // Classic studio reticle circle & L/R/M/S guides
    ctx.strokeStyle = 'rgba(232, 207, 170, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    // 45-deg L and R axes
    const d = r * 0.7071;
    ctx.moveTo(cx - d, cy - d);
    ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d);
    ctx.lineTo(cx - d, cy + d);
    ctx.stroke();

    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(201, 183, 156, 0.7)';
    ctx.textAlign = 'center';
    ctx.fillText('M (+)', cx, cy - r - 4);
    ctx.fillText('L', cx - d - 7, cy - d);
    ctx.fillText('R', cx + d + 7, cy - d);

    if (!isPlaying || !timeDataL || !timeDataR) return;

    const stroke = activeVersion === 'master' ? 'rgba(235, 180, 95, 0.85)' : 'rgba(224, 92, 66, 0.85)';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.beginPath();

    const step = 4;
    for (let i = 0; i < timeDataL.length; i += step) {
      const l = timeDataL[i];
      const rSamp = timeDataR[i];
      // Standard Mastering Goniometer rotation: Mid = vertical (up), Side = horizontal
      const x = ((rSamp - l) * 0.7071) * r;
      const y = -((l + rSamp) * 0.7071) * r;
      if (i === 0) ctx.moveTo(cx + x, cy + y);
      else ctx.lineTo(cx + x, cy + y);
    }
    ctx.stroke();
  }

  /**
   * 4. Live Oscilloscope / Transient Dynamics Ribbon (MiniMeters Style)
   */
  drawOscilloscope(canvas, timeDataL, timeDataR, activeVersion = 'master', isPlaying = false) {
    const { ctx, w, h } = fitHiDpi(canvas);
    ctx.fillStyle = '#0e0b09';
    ctx.fillRect(0, 0, w, h);

    const midY = h / 2;
    ctx.strokeStyle = 'rgba(232, 207, 170, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.moveTo(0, h * 0.15);
    ctx.lineTo(w, h * 0.15);
    ctx.moveTo(0, h * 0.85);
    ctx.lineTo(w, h * 0.85);
    ctx.stroke();

    if (!isPlaying || !timeDataL || !timeDataR) return;

    // Trigger on zero-crossing for rock-solid oscilloscope wave display
    let triggerIdx = 0;
    for (let i = 1; i < timeDataL.length / 2; i++) {
      if (timeDataL[i - 1] <= 0 && timeDataL[i] > 0) {
        triggerIdx = i;
        break;
      }
    }

    const samplesToShow = Math.min(720, timeDataL.length - triggerIdx);
    const scaleY = h * 0.44;

    // Subtle Right channel shadow
    ctx.strokeStyle = 'rgba(201, 183, 156, 0.32)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < samplesToShow; i++) {
      const x = (i / (samplesToShow - 1)) * w;
      const y = midY - timeDataR[triggerIdx + i] * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Primary Left / Stereo trace
    ctx.strokeStyle = activeVersion === 'master' ? '#ebb45f' : '#e05c42';
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    for (let i = 0; i < samplesToShow; i++) {
      const x = (i / (samplesToShow - 1)) * w;
      const y = midY - timeDataL[triggerIdx + i] * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
