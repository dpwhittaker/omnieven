declare module 'qrcode' {
  const QRCode: { toString(text: string, opts?: { type?: 'svg' | 'terminal' | 'utf8'; margin?: number; width?: number }): Promise<string> }
  export default QRCode
}
