// Audible and haptic confirmation for each scan.
//
// An operator holding a box is not looking at the screen, so the beep is the
// primary confirmation and the two tones have to be unmistakably different:
// a short high blip for a good scan, a low double buzz for a rejection.
//
// Synthesised with WebAudio rather than shipped as audio files — no asset to
// load, nothing to fail on a cold cache in a warehouse with bad wifi.

let ctx = null;

const context = () => {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
};

const tone = (freq, startAt, durationMs, volume = 0.15) => {
  const audio = context();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audio.destination);
  const t0 = audio.currentTime + startAt;
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000);
};

// iOS will not start an AudioContext outside a user gesture. Call this from the
// Start button so the first real scan is not silent.
export const primeAudio = async () => {
  const audio = context();
  if (audio && audio.state === "suspended") {
    try { await audio.resume(); } catch { /* stays silent, not fatal */ }
  }
};

export const beepSuccess = () => {
  try {
    tone(1200, 0, 70);
    if (navigator.vibrate) navigator.vibrate(30);
  } catch { /* audio is a nicety, never break a scan over it */ }
};

export const beepError = () => {
  try {
    tone(320, 0, 160, 0.2);
    tone(240, 0.2, 240, 0.2);
    if (navigator.vibrate) navigator.vibrate([60, 60, 120]);
  } catch { /* as above */ }
};

const scanFeedback = { primeAudio, beepSuccess, beepError };
export default scanFeedback;
