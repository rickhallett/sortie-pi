export interface ProgressMessage {
  customType: "sortie:progress";
  content: { sortie: string; status: string };
  display: string;
}

export type SendFn = (message: ProgressMessage) => void;

export function formatProgressLine(sortie: string, status: string): string {
  return `${sortie}: ${status}`;
}

export function emitProgress(send: SendFn, sortie: string, status: string): void {
  send({
    customType: "sortie:progress",
    content: { sortie, status },
    display: formatProgressLine(sortie, status),
  });
}
