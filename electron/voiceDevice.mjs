export class VoiceDevice {
  constructor(changed = () => {}) { this.deviceId = "desktop"; this.generation = 0; this.changed = changed; }
  status() { return { deviceId: this.deviceId, generation: this.generation }; }
  claim(deviceId, { renew = false } = {}) {
    if (deviceId !== this.deviceId || renew) { this.deviceId = deviceId; this.generation++; this.changed(this.status()); }
    return this.status();
  }
  release(deviceId) { if (this.deviceId === deviceId) this.claim(null); }
  accepts(deviceId, generation) { return this.deviceId === deviceId && (deviceId === "desktop" || generation === this.generation); }
}
