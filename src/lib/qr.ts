import QRCode from "qrcode";

export function eventsUrl(): string {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/events`;
}

export async function eventsQrSvg(): Promise<string> {
  return QRCode.toString(eventsUrl(), { type: "svg", margin: 1, color: { dark: "#0b1533", light: "#ffffff" } });
}

export async function eventsQrPng(): Promise<Buffer> {
  return QRCode.toBuffer(eventsUrl(), { type: "png", margin: 1, width: 1024, color: { dark: "#0b1533", light: "#ffffff" } });
}
