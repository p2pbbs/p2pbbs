import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { WebSocketServer } from "ws";
import { createApp, createConnectionHandler, PeerRegistry } from "./server.ts";

const PORT = Number(process.env["PORT"] ?? 8080);
const registry = new PeerRegistry();
const app = createApp(registry);

const tlsCertPath = process.env["TLS_CERT_PATH"];
const tlsKeyPath = process.env["TLS_KEY_PATH"];

const httpServer =
	tlsCertPath !== undefined && tlsKeyPath !== undefined
		? createHttpsServer(
				{ cert: readFileSync(tlsCertPath), key: readFileSync(tlsKeyPath) },
				app,
			)
		: createServer(app);

const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", createConnectionHandler(registry));

httpServer.listen(PORT, () => {
	const protocol = tlsCertPath !== undefined ? "wss" : "ws";
	console.log(`Signaling server listening on ${protocol}://0.0.0.0:${PORT}`);
});
