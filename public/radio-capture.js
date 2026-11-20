// 250 ms of mono PCM16 at 12 kHz.
class RadioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.samples = 0;
    this.offset = 0;
    this.frame = new Int16Array(3000);
    this.port.onmessage = () => {
      const audio = this.offset ? this.frame.buffer : null;
      this.port.postMessage({final:true,audio}, audio ? [audio] : []);
      this.finished = true;
    };
  }
  process(inputs) {
    if (this.finished) return false;
    for (const sample of inputs[0]?.[0] ?? []) {
      this.sum += sample;
      this.samples++;
      this.phase += 12000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      this.frame[this.offset++] = Math.max(-1, Math.min(1, this.sum / this.samples)) * 32767;
      this.sum = 0;
      this.samples = 0;
      if (this.offset === this.frame.length) {
        this.port.postMessage({audio:this.frame.buffer}, [this.frame.buffer]);
        this.frame = new Int16Array(3000);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('tariq-radio-capture', RadioCapture);
