/**
 * A tiny, framework-agnostic event emitter shaped like `vscode.EventEmitter` (`.event` / `.fire` / `.dispose`),
 * so the shared {@link VoltStatus} tracker works unchanged in the VS Code extension AND the desktop shell (which
 * can't import `vscode`). `.event(listener)` returns a disposable that unsubscribes.
 */
export interface Disposable {
	dispose(): void;
}

export class Emitter<T = void> {
	private readonly listeners = new Set<(value: T) => void>();

	/** Subscribe; returns a disposable that unsubscribes. Shaped like vscode's `Event<T>`. */
	readonly event = (listener: (value: T) => void): Disposable => {
		this.listeners.add(listener);
		return { dispose: () => void this.listeners.delete(listener) };
	};

	fire(value: T): void {
		// Iterate a snapshot so a listener that unsubscribes (or subscribes) during dispatch is safe.
		for (const l of [...this.listeners]) l(value);
	}

	dispose(): void {
		this.listeners.clear();
	}
}
