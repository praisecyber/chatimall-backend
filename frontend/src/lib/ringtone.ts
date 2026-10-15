/** Very small synthesized ring / ringback tone (no audio files needed). */
export function startRing(kind: 'incoming' | 'outgoing'): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const audio = ctx;
  const beep = () => {
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = kind === 'incoming' ? 480 : 425;
      gain.gain.value = 0.07;
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + (kind === 'incoming' ? 0.7 : 1.0));
    } catch {
      /* autoplay can be blocked until the user interacts – ignore */
    }
  };
  beep();
  const timer = setInterval(beep, kind === 'incoming' ? 2000 : 3000);
  return () => {
    clearInterval(timer);
    void audio.close().catch(() => {});
  };
}
