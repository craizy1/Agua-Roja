# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary creator audiences (3 core roles):**
  1. **Music Producers / Beatmakers:** Creators showcasing finished beats, instrumentals, or full productions (single-track showcase or Demo vs. Final Production comparison).
  2. **Mixing Engineers:** Engineers presenting before/after comparisons between a **Raw Recording / Rough Mix (A)** and their **Final Mix (B)**.
  3. **Mastering Engineers:** Engineers presenting before/after comparisons between a **Final Mix (A)** and their **Mastered Track (B)**.
- **Primary visitor audience — Recording artists, bands, vocalists, and record labels:** Clients evaluating a producer's or engineer's sonic craft before requesting a custom quote or booking a session.

## Product Purpose

Aguja Roja is a multi-producer mastering portfolio platform centered on a lossless A/B comparison console. Its purpose is to let artists, bands, and labels hear the real sonic difference between an unmastered mix and a finished master—without streaming compression or volume bias—so they have the confidence to request a custom mastering quote or book a session.

Success means a visiting artist or label listens to A/B comparisons, trusts the engineer's sonic judgment (optionally validating it with Pro metering tools), and submits a quote or booking inquiry.

## Positioning

Unlike generic music portfolios or compressed streaming embeds that bias listeners toward louder tracks, Aguja Roja pairs lossless `.WAV` sample-accurate A/B toggling with automatic ITU-R BS.1770-4 LUFS Loudness Matching and real-time mastering analyzers (20 Hz–20 kHz logarithmic spectrogram, stereo phase correlation, Lissajous vectorscope, oscilloscope, and Stereo/Mono/Mid/Side auditioning) inside a multi-producer showcase built specifically for mastering evaluation.

## Operating Context

- **Producer workflow:** Create or switch to a producer account, upload a custom profile photo, customize public bio/specialties/links, upload local `.WAV` Mix and Master pairs from computer folders, optionally generate cover art via Hugging Face free models or local fallback, switch to Client Mode to preview, and share with prospective clients.
- **Visitor evaluation workflow:** Play tracks directly from the console, toggle instantaneously between `MIX (Antes)` and `MÁSTER (Después)` (click or `T`/`M` key), toggle `Loudness Match` (`L` key), scrub the waveform or set an A-B section loop (`[`/`]`) on choruses/drops, optionally open the Pro Analyzer panel (`P` key) to verify spectral balance and phase correlation, and send a quote inquiry.
- **Local run & static deployment:** Runs as a static HTML/CSS/ES Modules web application (served locally via `python -m http.server 8080` or `abrir-portafolio.bat`, deployable to static hosts).

## Capabilities and Constraints

- **Confirmed current capabilities:**
  - 100% browser-side persistence using IndexedDB (`AnalogMasteringPortfolioDB` v2) for lossless `.WAV` Blobs, track metadata, waveforms, LUFS measurements, cover art, and local producer accounts (optional SHA-256 local PIN).
  - Sample-accurate Web Audio API dual-source A/B playback with 15 ms clickless crossfade, RIFF WAV header parsing, ITU-R BS.1770-4 K-weighted LUFS calculation, automatic attenuation-based Loudness Matching, and A-B section looping.
  - Pro Analyzer suite (MiniMeters-style): 4096-pt FFT 20 Hz–20,000 Hz scrolling waterfall spectrogram with Mix/Master switch markers, Pearson stereo phase correlation (`-1` to `+1`), Lissajous vectorscope, live transient oscilloscope, Mid/Side/Crest/Balance readouts, and Stereo/Mono/Mid/Side monitor matrix.
  - Cover art generation via Hugging Face Inference Router (`black-forest-labs/FLUX.1-schnell`, `stabilityai/stable-diffusion-xl-base-1.0`, `black-forest-labs/FLUX.1-dev`) with a user-supplied free HF token, plus offline Canvas fallback.
  - Editor Mode vs. Client Mode toggle, Spanish-language UI, and technical SEO foundations (`robots.txt`, `sitemap.xml`, Open Graph, JSON-LD `ProfessionalService`).
- **Pricing policy:** No public fixed prices. All mastering services are offered strictly via custom quote (*cotización a medida*).
- **Technical constraints & open decisions:**
  - Zero Node.js/backend runtime currently required (Python 3.12 available locally for static serving).
  - **Undecided / future scope:** Cloud authentication, remote multi-tenant database, and public shareable per-producer URLs (`/@handle`) are not yet built; accounts and `.WAV` files currently persist per browser in IndexedDB.
  - **Undecided / future scope:** Production domain URL (currently using `https://agujaroja.audio/` as placeholder in SEO metadata, `robots.txt`, and `sitemap.xml`).

## Brand Commitments

- **Brand name:** **Aguja Roja** (Spanish-only primary brand identity).
- **Binding thematic reference:** Vintage analog audio craftsmanship—wood tones, vinyl records, turntables, cassettes, and authentic mastering metering instruments.
- **Functional reference:** Inspired by SoundToggle's A/B lossless comparison and LUFS Loudness Matching, plus MiniMeters' real-time mastering measurement suite.
- **Language:** Spanish (`es`), using authentic mastering and analog audio terminology.

## Evidence on Hand

- **Real working demonstration:** Synthesized lossless 16-bit 44.1 kHz stereo `.WAV` Mix vs. Master demo pair (`js/demo-synth.js`) for immediate A/B and LUFS testing.
- **Real assets:** Custom favicon (`assets/favicon.svg`), modular static codebase (`index.html`, `404.html`, `css/`, `js/`), and project agent references (`.agents/agency-agents/`, `.agents/impeccable/`).
- **Explicit absences (do not fabricate):**
  - No public fixed pricing or rate cards.
  - Producer location, real studio gear list, client credits, discography, testimonials, and contact email are currently placeholders pending completion by each producer. Future work must never invent real credits, awards, client logos, or testimonials.

## Product Principles

1. **Honest listening first:** Comparisons must preserve lossless `.WAV` fidelity, zero-latency time alignment, and level-matched evaluation so musical decisions speak louder than raw loudness.
2. **Technical credibility without friction:** Pro analyzers (spectrogram, phase correlation, Mono/Mid/Side matrix) must be immediately accessible during playback without cluttering a client's first listening impression.
3. **Producer ownership:** Every producer should be able to personalize their portrait, identity, bio, and track catalog cleanly and preview the exact client experience before sharing.
4. **Zero fabricated proof:** Keep unconfirmed studio details, credits, and quotes clearly editable or quote-based rather than inventing credentials or fixed prices.

## Accessibility & Inclusion

- Keyboard-operable transport and mastering controls (`Space` play/pause, `T`/`M` Mix/Master toggle, `L` Loudness Match, `P` Pro Panel, `[`/`]` Loop A-B) disabled safely while typing in form inputs.
- Visible focus indicators, ARIA pressed/expanded states on console toggles, tabular numerals on all technical audio readouts, and `prefers-reduced-motion` support to pause vinyl rotation and animations.
