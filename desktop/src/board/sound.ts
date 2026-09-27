let audio: AudioContext | undefined
let sample: Promise<AudioBuffer> | undefined

// Resume inside the click gesture, before awaiting the SGF edit IPC round trip.
export function prepareStoneSound() {
  audio ??= new AudioContext()
  void audio.resume().catch(() => undefined)
  sample ??= fetch(new URL('../../../assets/stone.mp3', import.meta.url).href)
    .then(response => response.arrayBuffer()).then(bytes => audio!.decodeAudioData(bytes))
  void sample.catch(() => {sample = undefined})
}

export function playStoneSound() {
  void sample?.then(buffer => {
    const source = audio!.createBufferSource()
    source.buffer = buffer
    source.connect(audio!.destination)
    source.start()
    source.onended = () => source.disconnect()
  }).catch(() => undefined)
}
