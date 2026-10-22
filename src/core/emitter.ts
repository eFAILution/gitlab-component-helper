/** Structural match for `vscode.Disposable`, so core objects can go straight into `context.subscriptions`. */
export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (value: T) => void) => Disposable;

/** A minimal stand-in for `vscode.EventEmitter` that works without VS Code. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    [...this.listeners].forEach((listener) => listener(value));
  }

  dispose(): void {
    this.listeners.clear();
  }
}
