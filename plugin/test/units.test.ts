import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUsdc, parseAddress, parseUsdc, parseWholeUsdc } from "../src/chain.js";
import { NETWORKS, ZERO } from "../src/config.js";

test("parseUsdc converts decimals exactly", () => {
  assert.equal(parseUsdc("1"), 1_000_000n);
  assert.equal(parseUsdc("12.5"), 12_500_000n);
  assert.equal(parseUsdc("0.000001"), 1n);
});

test("parseUsdc rejects bad amounts", () => {
  for (const bad of ["0", "-1", "1.0000001", "abc", "1e6", "01", ""]) assert.throws(() => parseUsdc(bad), bad);
});

test("formatUsdc round-trips", () => {
  for (const s of ["1", "12.5", "0.000001", "100"]) assert.equal(formatUsdc(parseUsdc(s)), s);
});

test("parseAddress rejects zero and junk", () => {
  assert.throws(() => parseAddress(ZERO, "x"));
  assert.throws(() => parseAddress("0x123", "x"));
  assert.equal(parseAddress("0xaf88d065e77c8cc2239327c5edb3a432268e5831", "x"), "0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
});

test("config: USDC addresses match Circle's published addresses", () => {
  assert.equal(NETWORKS.arbitrum.usdc, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
  assert.equal(NETWORKS["arbitrum-sepolia"].usdc, "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
  assert.equal(NETWORKS.arbitrum.chainId, 42161);
  assert.equal(NETWORKS["arbitrum-sepolia"].chainId, 421614);
  assert.equal(NETWORKS.ethereum.usdc, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(NETWORKS.sepolia.usdc, "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
  assert.equal(NETWORKS.ethereum.chainId, 1);
  assert.equal(NETWORKS.sepolia.chainId, 11155111);
});

test("config: every network key matches its entry", () => {
  for (const [k, n] of Object.entries(NETWORKS)) assert.equal(n.key, k);
});

test("deposits and withdrawals must be whole USDC", () => {
  assert.equal(parseWholeUsdc("40"), 40_000_000n);
  for (const bad of ["37.12", "0.5", "1.000001"]) assert.throws(() => parseWholeUsdc(bad), bad);
});
