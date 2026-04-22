import { z } from "zod";
import { GossipMessageSchema } from "./GossipMessage";

export const DataChannelMessageSchema = z.union([
	z.object({ type: z.literal("gossip"), message: GossipMessageSchema }),
	z.object({ type: z.literal("heartbeat") }),
]);

export type DataChannelMessage = z.infer<typeof DataChannelMessageSchema>;
