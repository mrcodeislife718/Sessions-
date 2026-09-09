import type { JsonWebKey as NodeJsonWebKey } from 'node:crypto';

declare global {
  interface JsonWebKey extends NodeJsonWebKey {}
}

export {};
