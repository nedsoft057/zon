import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { preparePermit, viewBalance } from "../src/view.js";
import { NETWORKS } from "../src/config.js";
const acct = privateKeyToAccount(generatePrivateKey());
for (const n of Object.values(NETWORKS)) {
  const t0 = Date.now();
  try {
    const p = await preparePermit(n, acct.address, n.usdc, 30);
    const sig = await acct.signTypedData(p.typedData as any);
    const td = p.typedData as any;
    console.log(n.key, Date.now() - t0 + "ms", td.domain, td.primaryType, Object.keys(td.message).join(","), "blob", p.permit.length);
    // wrong signature must be rejected
    const bad = await privateKeyToAccount(generatePrivateKey()).signTypedData(p.typedData as any);
    await viewBalance(n, acct.address, n.usdc, p.permit, bad, 5000).then(() => console.log("  BAD SIG ACCEPTED"), e => console.log("  bad sig ->", e.message.slice(0, 80)));
    // good signature gets past verification, then fails at USDC (no confidentialBalanceOf), as expected
    await viewBalance(n, acct.address, n.usdc, p.permit, sig, 5000).then(v => console.log("  ok?", v), e => console.log("  good sig ->", (e.shortMessage || e.message).slice(0, 80)));
  } catch (e: any) { console.log(n.key, "ERR", e.message.slice(0, 300)); }
}
