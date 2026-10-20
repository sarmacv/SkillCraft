import type { WebviewMessage } from '../../src/core/messages';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode: VsCodeApi = acquireVsCodeApi();
export const post = (m: WebviewMessage) => vscode.postMessage(m);
