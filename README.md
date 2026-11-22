# tiny-stack-vm

A tiny stack virtual machine in one TypeScript file, built for make.fun's "Build a tiny stack virtual machine" bounty: exact reference semantics for the kit's stack ISA — wrapping 32-bit arithmetic, unsigned operations, every trap code.

## Run it

    node main.ts

Reads instances from /input (or MAKEFUN_INPUT_DIR) and writes stdout.bin + exit.txt per instance to /output (or MAKEFUN_OUTPUT_DIR).
