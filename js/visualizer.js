/* ==========================================================================
   HIGH-DPI CANVAS VISUALIZERS
   1. Interactive Mirrored Waveform + Ghost A/B Overlay + A-B Loop Brackets
   2. Authentic Dual Analog VU Meters (Warm Backlit Parchment + Needles)
   3. Logarithmic Vintage Brass Spectrum Analyzer with Peak-Hold Caps
   ========================================================================== */

function fitCanvas(canvas) {
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

/**
 * Draw interactive waveform showing active version (Mix or Master),
 * subtle ghost comparison of the other version, A-B loop region, and playhead.
 */
export function drawWaveform(canvas, state) {
  const { ctx, w, h } = fitCanvas(canvas);
  const {
    mixWave = [],
    masterWave = [],
    activeVersion = 'master',
    progress = 0,
    loopEnabled = false,
    loopStartRatio = 0,
    loopEndRatio = 1,
  } = state;

  ctx.clearRect(0, 0, w, h);

  // Subtle horizontal studio zero-axis & dB guide lines
  const midY = h / 2;
  ctx.strokeStyle = 'rgba(232, 207, 170, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.moveTo(0, h * 0.22);
  ctx.lineTo(w, h * 0.22);
  ctx.moveTo(0, h * 0.78);
  ctx.lineTo(w, h * 0.78);
  ctx.stroke();

  // Loop A-B shaded zone
  if (loopEnabled && loopEndRatio > loopStartRatio) {
    const lx1 = loopStartRatio * w;
    const lx2 = loopEndRatio * w;
    ctx.fillStyle = 'rgba(212, 149, 63, 0.14)';
    ctx.fillRect(lx1, 0, lx2 - lx1, h);

    ctx.strokeStyle = 'rgba(235, 180, 95, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx1, 0);
    ctx.lineTo(lx1, h);
    ctx.moveTo(lx2, 0);
    ctx.lineTo(lx2, h);
    ctx.stroke();

    // Small brass A / B flags
    ctx.fillStyle = '#ebb45f';
    ctx.fillRect(lx1, 0, 16, 15);
    ctx.fillRect(Math.max(0, lx2 - 16), 0, 16, 15);
    ctx.fillStyle = '#1c140e';
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', lx1 + 8, 8);
    ctx.fillText('B', Math.max(8, lx2 - 8), 8);
  }

  const activeWave = activeVersion === 'master' ? masterWave : mixWave;
  const ghostWave = activeVersion === 'master' ? mixWave : masterWave;

  if (!activeWave || activeWave.length === 0) {
    ctx.fillStyle = 'rgba(201, 183, 156, 0.45)';
    ctx.font = '500 12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Selecciona o sube un track .wav (Mix + Máster) para visualizar su forma de onda', w / 2, midY);
    return;
  }

  const count = activeWave.length;
  const step = w / count;
  const barW = Math.max(1.6, step * 0.64);
  const maxAmp = h * 0.44;
  const playX = Math.max(0, Math.min(w, progress * w));

  // Normalize visual peak slightly so quiet raw mixes remain legible while preserving real relative density
  let peakRef = 0.01;
  for (let i = 0; i < count; i++) {
    if (masterWave[i] > peakRef) peakRef = masterWave[i];
    if (mixWave[i] > peakRef) peakRef = mixWave[i];
  }
  const scale = 1 / Math.max(0.35, peakRef);

  // 1. Subtle ghost silhouette of the inactive version behind
  if (ghostWave && ghostWave.length === count) {
    ctx.fillStyle = 'rgba(232, 207, 170, 0.11)';
    for (let i = 0; i < count; i++) {
      const amp = Math.min(1, ghostWave[i] * scale) * maxAmp;
      const x = i * step;
      ctx.fillRect(x, midY - amp, barW, Math.max(2, amp * 2));
    }
  }

  // 2. Active waveform bars (Played vs Unplayed tint)
  const playedColor = activeVersion === 'master' ? '#ebb45f' : '#e37152';
  const unplayedColor = activeVersion === 'master' ? 'rgba(212, 149, 63, 0.44)' : 'rgba(201, 88, 58, 0.44)';

  for (let i = 0; i < count; i++) {
    const amp = Math.min(1, activeWave[i] * scale) * maxAmp;
    const x = i * step;
    ctx.fillStyle = x <= playX ? playedColor : unplayedColor;
    const barH = Math.max(2.5, amp * 2);
    ctx.fillRect(x, midY - barH / 2, barW, barH);
  }

  // 3. Precision Brass Playhead Needle
  ctx.strokeStyle = '#f4ebd9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playX, 0);
  ctx.lineTo(playX, h);
  ctx.stroke();

  // Playhead cap diamond
  ctx.fillStyle = activeVersion === 'master' ? '#ebb45f' : '#e37152';
  ctx.beginPath();
  ctx.moveTo(playX, 0);
  ctx.lineTo(playX + 5, 7);
  ctx.lineTo(playX, 14);
  ctx.lineTo(playX - 5, 7);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw dual stereo Analog VU Meters (L & R) with warm backlit parchment dials.
 */
export function drawAnalogVuMeters(canvas, vuL = -20, vuR = -20) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const gap = 8;
  const meterW = (w - gap) / 2;

  const drawSingleDial = (x0, label, vuVal) => {
    const mw = meterW;
    const mh = h;

    ctx.save();
    // Rounded dial glass clip
    ctx.beginPath();
    ctx.roundRect(x0, 0, mw, mh, 5);
    ctx.clip();

    // Warm tungsten backlit parchment dial background
    const bgGrad = ctx.createRadialGradient(
      x0 + mw * 0.5,
      mh * 0.92,
      8,
      x0 + mw * 0.5,
      mh * 0.65,
      mw * 0.85
    );
    bgGrad.addColorStop(0, '#f8ebd0');
    bgGrad.addColorStop(0.7, '#ebd6ad');
    bgGrad.addColorStop(1, '#c9ab78');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(x0, 0, mw, mh);

    // Pivot center below bottom edge
    const cx = x0 + mw / 2;
    const cy = mh * 1.18;
    const radius = Math.min(mw * 0.72, mh * 0.92);

    // Scale maps -20..+3 VU to angle -44deg..+44deg (0 VU at +16deg)
    const vuToAngle = (v) => {
      const clamped = Math.max(-20, Math.min(3, v));
      const norm = (clamped + 20) / 23; // 0..1
      const deg = -44 + norm * 88;
      return ((deg - 90) * Math.PI) / 180;
    };

    // Black safe arc (-20 to 0 VU)
    ctx.strokeStyle = '#251a12';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, vuToAngle(-20), vuToAngle(0));
    ctx.stroke();

    // Red overload arc (0 to +3 VU)
    ctx.strokeStyle = '#b93424';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, vuToAngle(0), vuToAngle(3));
    ctx.stroke();

    // Scale ticks & numbers
    const ticks = [-20, -10, -7, -5, -3, 0, 3];
    ctx.font = '700 8px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const t of ticks) {
      const ang = vuToAngle(t);
      const isRed = t > 0;
      ctx.strokeStyle = isRed ? '#b93424' : '#2b1e15';
      ctx.fillStyle = isRed ? '#b93424' : '#2b1e15';
      ctx.lineWidth = t === 0 ? 1.8 : 1;

      const r1 = radius - 3;
      const r2 = radius + 5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.stroke();

      const rt = radius + 12;
      const text = t > 0 ? `+${t}` : `${t}`;
      ctx.fillText(text, cx + Math.cos(ang) * rt, cy + Math.sin(ang) * rt);
    }

    // Channel label ("VU · L" / "VU · R")
    ctx.fillStyle = '#4f3a29';
    ctx.font = '700 9px "DM Sans", sans-serif';
    ctx.fillText(`VU · ${label}`, cx, mh * 0.64);

    // Needle shadow + Needle
    const needleAng = vuToAngle(vuVal);
    const needleLen = radius + 6;
    const tipX = cx + Math.cos(needleAng) * needleLen;
    const tipY = cy + Math.sin(needleAng) * needleLen;

    ctx.strokeStyle = 'rgba(28, 20, 14, 0.24)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy + 2);
    ctx.lineTo(tipX + 2, tipY + 2);
    ctx.stroke();

    ctx.strokeStyle = vuVal > 0 ? '#a82c1e' : '#1b140e';
    ctx.lineWidth = 1.65;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Pivot cap + top bezel vignette
    ctx.fillStyle = '#1f1712';
    ctx.beginPath();
    ctx.arc(cx, mh + 2, 11, 0, Math.PI * 2);
    ctx.fill();

    // Subtle glass reflection at top
    const glass = ctx.createLinearGradient(x0, 0, x0, mh * 0.45);
    glass.addColorStop(0, 'rgba(255, 252, 244, 0.28)');
    glass.addColorStop(1, 'rgba(255, 252, 244, 0)');
    ctx.fillStyle = glass;
    ctx.fillRect(x0, 0, mw, mh * 0.45);

    ctx.strokeStyle = 'rgba(28, 18, 10, 0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 0.5, 0.5, mw - 1, mh - 1);
    ctx.restore();
  };

  drawSingleDial(0, 'L', vuL);
  drawSingleDial(meterW + gap, 'R', vuR);
}

/**
 * Draw logarithmic vintage brass/amber spectrum analyzer with falling peak caps.
 */
const spectrumPeaks = new Float32Array(44);

export function drawSpectrum(canvas, freqData, sampleRate = 48000, activeVersion = 'master') {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const numBands = 44;
  const bottomPad = 14;
  const chartH = h - bottomPad;
  const bandGap = 2;
  const barW = Math.max(2, (w - (numBands - 1) * bandGap) / numBands);

  // Subtle vertical frequency grid reference
  ctx.strokeStyle = 'rgba(232, 207, 170, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, chartH);
  ctx.lineTo(w, chartH);
  ctx.stroke();

  const minFreq = 30;
  const maxFreq = Math.min(18500, sampleRate / 2);
  const nyquist = sampleRate / 2;
  const binCount = freqData ? freqData.length : 0;

  const baseColor = activeVersion === 'master' ? '#d4953f' : '#c9583a';
  const topColor = activeVersion === 'master' ? '#f3cb80' : '#f08a6c';

  for (let b = 0; b < numBands; b++) {
    let level = 0;
    if (freqData && binCount > 0) {
      const fLow = minFreq * Math.pow(maxFreq / minFreq, b / numBands);
      const fHigh = minFreq * Math.pow(maxFreq / minFreq, (b + 1) / numBands);
      const iLow = Math.max(0, Math.floor((fLow / nyquist) * binCount));
      const iHigh = Math.min(binCount - 1, Math.max(iLow, Math.ceil((fHigh / nyquist) * binCount)));

      let sum = 0;
      for (let i = iLow; i <= iHigh; i++) sum += freqData[i];
      level = sum / ((iHigh - iLow + 1) * 255);
    }

    if (level > spectrumPeaks[b]) {
      spectrumPeaks[b] = level;
    } else {
      spectrumPeaks[b] = Math.max(0, spectrumPeaks[b] - 0.018);
    }

    const x = b * (barW + bandGap);
    const barH = Math.max(2, level * (chartH - 3));
    const y = chartH - barH;

    const grad = ctx.createLinearGradient(x, chartH, x, y);
    grad.addColorStop(0, baseColor);
    grad.addColorStop(1, topColor);
    ctx.fillStyle = freqData ? grad : 'rgba(212, 149, 63, 0.16)';
    ctx.fillRect(x, y, barW, barH);

    // Peak hold cap
    if (spectrumPeaks[b] > 0.03) {
      const py = chartH - spectrumPeaks[b] * (chartH - 3) - 2;
      ctx.fillStyle = '#f4ebd9';
      ctx.fillRect(x, Math.max(0, py), barW, 1.8);
    }
  }

  // Frequency labels along bottom
  const marks = [
    { f: 60, lbl: '60Hz' },
    { f: 250, lbl: '250' },
    { f: 1000, lbl: '1k' },
    { f: 4000, lbl: '4k' },
    { f: 12000, lbl: '12k' },
  ];
  ctx.fillStyle = 'rgba(201, 183, 156, 0.65)';
  ctx.font = '500 9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const m of marks) {
    const ratio = Math.log(m.f / minFreq) / Math.log(maxFreq / minFreq);
    if (ratio > 0.04 && ratio < 0.96) {
      ctx.fillText(m.lbl, ratio * w, h);
    }
  }
}
