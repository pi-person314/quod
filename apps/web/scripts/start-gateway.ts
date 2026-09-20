import { gatewayKey } from "../lib/deployment";
import { createGateway } from "./tunnel-gateway";
const port = Number(process.env.QUOD_GATEWAY_PORT ?? 3005);
const backendPort = Number(process.env.QUOD_LOCAL_BACKEND_PORT ?? 3003);
for (const value of [port, backendPort]) if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("Invalid gateway/backend port");
createGateway(new URL(`http://127.0.0.1:${backendPort}`), gatewayKey())
  .listen(port, "127.0.0.1", () => console.log(`Quod protected gateway ready on 127.0.0.1:${port}`));
