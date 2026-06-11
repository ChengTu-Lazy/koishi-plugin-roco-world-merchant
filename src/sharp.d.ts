declare module 'sharp' {
  export interface SharpConstructorOptions {
    density?: number
  }

  export interface SharpInstance {
    png(): SharpInstance
    toBuffer(): Promise<Buffer>
  }

  export default function sharp(
    input?: Buffer | ArrayBuffer | Uint8Array | string,
    options?: SharpConstructorOptions,
  ): SharpInstance
}
