// Ephemeral typing requests are serialized so a slow "true" cannot overtake "false".
export class TypingController {
  private room: string | null = null;
  private lastSent = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private queue = Promise.resolve();
  constructor(
    private send: (
      room: string,
      typing: boolean,
      timeout: number,
    ) => Promise<unknown>,
  ) {}
  update(room: string, active: boolean) {
    if (this.room && (this.room !== room || !active)) this.stop();
    if (!active) return;
    const changed = this.room !== room;
    this.room = room;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(), 5000);
    if (changed || Date.now() - this.lastSent >= 8000) {
      this.lastSent = Date.now();
      this.enqueue(room, true);
    }
  }
  stop() {
    clearTimeout(this.timer);
    if (this.room) this.enqueue(this.room, false);
    this.room = null;
    return this.queue;
  }
  private enqueue(room: string, active: boolean) {
    this.queue = this.queue
      .then(async () => {
        // Drop obsolete starts that have not reached the network yet.
        if (active && this.room !== room) return;
        await this.send(room, active, 15000);
      })
      .catch(() => {
        /* Typing failures must never block sending a message. */
      });
  }
}
