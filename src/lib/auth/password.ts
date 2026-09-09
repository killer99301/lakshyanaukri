// ═══════════════════════════════════════════════════════════
// Password hashing — @node-rs/argon2 (prebuilt Windows binaries)
// ═══════════════════════════════════════════════════════════
//
// Algorithm: Argon2id with OWASP-recommended parameters
//   memoryCost: 65536 (64 MiB)
//   timeCost:   3 iterations
//   parallelism: 4
// ═══════════════════════════════════════════════════════════

import { hash, verify } from "@node-rs/argon2";

// Algorithm.Argon2id = 2 (const enum — use literal for isolatedModules compatibility)
const ARGON2_OPTIONS = {
  algorithm: 2 as const, // Argon2id
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

/** Hash a plaintext password using Argon2id. */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against its stored hash.
 * Returns false on any error (never throws).
 */
export async function verifyPassword(
  storedHash: string,
  plain: string
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
