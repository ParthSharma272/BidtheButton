import { runPaymentRecovery } from "../payments/service.ts";

// One-shot payment recovery. The web process also runs this every 30s.
const stats = await runPaymentRecovery();
console.log("Payment recovery:", stats);
