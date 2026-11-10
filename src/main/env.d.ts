/// <reference types="electron-vite/node" />

// Imports de assets procesados por electron-vite (?asset devuelve una ruta)
declare module '*?asset' {
  const src: string
  export default src
}
