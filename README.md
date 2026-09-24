Breath Lantern 🫧
A single glowing light that guides your breath — pick a science-based session or build your own, in 8 languages. No install, no build step, no server: it's one self-contained HTML file.

What it does
A breathing light. A soft orb on a dark ground grows on the inhale and settles on the exhale, its color crossfading gently (in OKLab space, so transitions never go muddy) between the colors you set for inhale / hold / exhale / hold.
Six built-in sessions — Calm, Focus, Energize, Unwind, Reset, Coherence — each a short sequence of real breathwork patterns (box breathing, 4-7-8, extended-exhale, resonance breathing) with a plain-language explanation of why it's built the way it is. Tap a flag-sized name on the main screen, or a Start button in Adjust, and it begins immediately.
Build your own. Add up to 8 blocks, each with its own inhale/hold/exhale/hold timing and colors, a duration, and a rest before the next block.
A "get ready" breath — a short inhale and a full, unhurried exhale — eases you in before every fresh session instead of starting abruptly.
Optional gongs. Six synthesized bell/bowl/gong voices (Web Audio API, no audio files) mark the start of each phase.
8 languages, switchable from small flags on the main screen: English, Deutsch, Français, Español, Português, 中文, हिन्दी, and العربية (with right-to-left text support).
Every setting — your program, colors, sound, language — is saved locally in the browser, so it's there next time.
Using it
Just open breath-lantern.html in any modern browser (desktop or mobile). That's it — nothing to install, nothing to build, no internet connection required after the first load (the only external request is for the display fonts; without a connection it falls back to your system fonts and everything still works).

Tech notes
Zero dependencies. Plain HTML/CSS/JavaScript in one file, no framework, no bundler.
Fonts: Fraunces (display), Instrument Sans (UI), IBM Plex Mono (numerals) via Google Fonts, with system-font fallbacks.
Audio: gongs are synthesized at runtime with the Web Audio API — inharmonic partials, exponential decay, a touch of convolver reverb — not sample playback.
Color math: breathing-phase crossfades are computed in OKLab and eased with smoothstep, so a phase starts blending into the next one shortly before it ends rather than cutting abruptly.
State: everything persists to a single localStorage key; there's no backend.
Adding a language or a preset
All UI strings and preset content (name, description, the science write-up, per-block notes) live in one I18N object near the top of the <script>, one sub-object per language with an identical key shape — copy an existing language's block as a template.
The six built-in presets are defined structurally (colors/timing only) in the PRESETS array; their translated text lives in I18N[lang].presets.
Flags are small hand-drawn inline SVGs (flagSVG()) rather than emoji, so they render as true circles on every platform.
License
Personal project, shared as-is.
