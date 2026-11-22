// A tiny stack VM for make.fun's tiny stack ISA (v1), matching the reference
// semantics exactly: wrapping 32-bit arithmetic, unsigned ops read as unsigned,
// shift counts mod 32, and every trap reported with its own exit code while
// keeping the output written before it. Typed arrays, one pass, no deps.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const enc = new TextEncoder();

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; code: number } {
  const D = new Int32Array(256); // data stack
  const C = new Int32Array(64); // call stack
  const M = new Int32Array(256); // memory, zeroed
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, olen = 0, ip = 0, pc = 0, steps = 0;
  const n = p.length;
  const done = (code: number) => ({ out: out.slice(0, olen), code });

  for (;;) {
    if (steps === 1000000) return done(10); // step limit
    if (pc < 0 || pc >= n) return done(9); // pc outside the program
    const op = p[pc];
    const imm = op === 0x01 ? 1 : op === 0x02 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
    if (imm > 0 && pc + imm >= n) return done(9); // immediate cut off
    steps++;
    switch (op) {
      case 0x00: return done(0); // HALT
      case 0x01: // PUSH8, sign-extended
        if (sp === 256) return done(3);
        D[sp++] = (p[pc + 1] << 24) >> 24; pc += 2; break;
      case 0x02: // PUSH32, little-endian
        if (sp === 256) return done(3);
        D[sp++] = p[pc + 1] | (p[pc + 2] << 8) | (p[pc + 3] << 16) | (p[pc + 4] << 24);
        pc += 5; break;
      case 0x03: // POP
        if (sp < 1) return done(2);
        sp--; pc++; break;
      case 0x04: // DUP
        if (sp < 1) return done(2);
        if (sp === 256) return done(3);
        D[sp] = D[sp - 1]; sp++; pc++; break;
      case 0x05: { // SWAP
        if (sp < 2) return done(2);
        const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; pc++; break;
      }
      case 0x06: // OVER
        if (sp < 2) return done(2);
        if (sp === 256) return done(3);
        D[sp] = D[sp - 2]; sp++; pc++; break;
      case 0x07: { // ROT: ( a b c -- b c a )
        if (sp < 3) return done(2);
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; pc++; break;
      }
      case 0x17: // NEG
        if (sp < 1) return done(2);
        D[sp - 1] = -D[sp - 1] | 0; pc++; break;
      case 0x1b: // NOT
        if (sp < 1) return done(2);
        D[sp - 1] = ~D[sp - 1]; pc++; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      case 0x16: case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d:
      case 0x1e: case 0x20: case 0x21: case 0x22: { // binary operations
        if (sp < 2) return done(2);
        const b = D[sp - 1], a = D[sp - 2];
        let r: number;
        if (op === 0x10) r = (a + b) | 0; // ADD
        else if (op === 0x11) r = (a - b) | 0; // SUB
        else if (op === 0x12) r = Math.imul(a, b); // MUL, exact low 32 bits
        else if (op === 0x13) { // DIV, truncated toward zero
          if (b === 0) return done(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) { // MOD, sign of the dividend
          if (b === 0) return done(4);
          r = b === -1 ? 0 : a % b | 0;
        } else if (op === 0x15) { // DIVU
          if (b === 0) return done(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) { // MODU
          if (b === 0) return done(4);
          r = (a >>> 0) % (b >>> 0) | 0;
        } else if (op === 0x18) r = a & b; // AND
        else if (op === 0x19) r = a | b; // OR
        else if (op === 0x1a) r = a ^ b; // XOR
        else if (op === 0x1c) r = a << (b & 31); // SHL
        else if (op === 0x1d) r = a >> (b & 31); // SHR, arithmetic
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0; // SHRU, logical
        else if (op === 0x20) r = a === b ? 1 : 0; // EQ
        else if (op === 0x21) r = a < b ? 1 : 0; // LT, signed
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU, unsigned
        D[sp - 2] = r; sp--; pc++; break;
      }
      case 0x30: case 0x31: case 0x32: { // JMP, JZ, JNZ: signed offset from next instruction
        const rel = ((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16;
        let take = op === 0x30;
        if (op !== 0x30) {
          if (sp < 1) return done(2);
          const v = D[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        pc = take ? pc + 3 + rel : pc + 3; break;
      }
      case 0x33: // CALL: the immediate is an absolute address
        if (csp === 64) return done(7);
        C[csp++] = pc + 3; pc = p[pc + 1] | (p[pc + 2] << 8); break;
      case 0x34: // RET
        if (csp === 0) return done(8);
        pc = C[--csp]; break;
      case 0x40: { // LOAD
        if (sp < 1) return done(2);
        const addr = D[sp - 1];
        if (addr < 0 || addr > 255) return done(6);
        D[sp - 1] = M[addr]; pc++; break;
      }
      case 0x41: { // STORE: ( v addr -- )
        if (sp < 2) return done(2);
        const addr = D[sp - 1];
        if (addr < 0 || addr > 255) return done(6);
        M[addr] = D[sp - 2]; sp -= 2; pc++; break;
      }
      case 0x50: { // PRINT: the value in decimal; a print past the limit writes nothing
        if (sp < 1) return done(2);
        const bytes = enc.encode(String(D[sp - 1]));
        if (olen + bytes.length > 65536) return done(11);
        sp--; out.set(bytes, olen); olen += bytes.length; pc++; break;
      }
      case 0x51: // PUTC: one byte
        if (sp < 1) return done(2);
        if (olen + 1 > 65536) return done(11);
        out[olen++] = D[--sp] & 255; pc++; break;
      case 0x52: // IN: -1 once the input is used up
        if (sp === 256) return done(3);
        D[sp++] = ip < inp.length ? inp[ip++] : -1; pc++; break;
      case 0x53: // EXIT: the low byte of the value
        if (sp < 1) return done(2);
        return done(D[sp - 1] & 255);
      default: return done(5); // no opcode names this byte
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(
    new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))),
  );
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
