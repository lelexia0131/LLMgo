let audio: AudioContext | undefined

export function playStoneSound() {
  audio ??= new AudioContext()
  void audio.resume().then(() => {
    if (!audio) return
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    const time = audio.currentTime
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(950, time)
    oscillator.frequency.exponentialRampToValueAtTime(180, time + .055)
    gain.gain.setValueAtTime(.22, time)
    gain.gain.exponentialRampToValueAtTime(.001, time + .065)
    oscillator.connect(gain); gain.connect(audio.destination)
    oscillator.start(time); oscillator.stop(time + .07)
    oscillator.onended = () => {oscillator.disconnect(); gain.disconnect()}
  }).catch(() => undefined)
}
