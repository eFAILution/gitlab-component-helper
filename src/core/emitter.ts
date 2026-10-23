/** Structural match for `vscode.Disposable`, so core objects can go straight into `context.subscriptions`. */
export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (value: T) => void) => Disposable;

import { Logger } from '../utils/logger';

/**
 * A minimal stand-in for `vscode.EventEmitter` that works without VS Code. Like VS Code's emitter, a listener that
 * throws is logged and skipped, so it can't break the other listeners or the code that fired the event.
 */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    [...this.listeners].forEach((listener) => {
      try {
        listener(value);
      } catch (error) {
        Logger.getInstance().error(`[Emitter] Event listener failed: ${error}`, 'Emitter');
      }
    });
  }

  dispose(): void {
    this.listeners.clear();
  }
}
