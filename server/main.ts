import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { WebSocketServer } from "ws";
import { createApp, createConnectionHandler, PeerRegistry } from "./server.ts";

const PORT = Number(process.env["PORT"] ?? 8765);
const registry = new PeerRegistry();
const app = createApp(registry);

const tlsCertPath = process.env["TLS_CERT_PATH"];
const tlsKeyPath = process.env["TLS_KEY_PATH"];

function makeHttpServer(): Server {
	return tlsCertPath !== undefined && tlsKeyPath !== undefined
		? createHttpsServer(
				{ cert: readFileSync(tlsCertPath), key: readFileSync(tlsKeyPath) },
				app,
			)
		: createServer(app);
}

function listenOn(server: Server, port: number, host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (err: Error) => reject(err);
		server.once("error", onError);
		server.listen(port, host, () => {
			server.off("error", onError);
			resolve();
		});
	});
}

const httpV4 = makeHttpServer();
const httpV6 = makeHttpServer();
const handler = createConnectionHandler(registry);

new WebSocketServer({ server: httpV4 }).on("connection", handler);
new WebSocketServer({ server: httpV6 }).on("connection", handler);

const protocol = tlsCertPath !== undefined ? "wss" : "ws";

try {
	await Promise.all([
		listenOn(httpV4, PORT, "0.0.0.0"),
		listenOn(httpV6, PORT, "::"),
	]);
	console.log(
		`Signaling server listening on ${protocol}://0.0.0.0:${PORT} and ${protocol}://[::]:${PORT}`,
	);
} catch (err) {
	console.error(
		`[signaling] FATAL: cannot bind port ${PORT} —`,
		(err as NodeJS.ErrnoException).message,
	);
	process.exit(1);
}
