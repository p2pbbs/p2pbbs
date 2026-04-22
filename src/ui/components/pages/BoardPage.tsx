import { useCallback, useMemo } from "react";
import {
	DEFAULT_BOARD_ID,
	DEFAULT_THREAD_ID,
	DEFAULT_THREAD_TITLE,
} from "@/core/config/constants";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { CryptoService } from "@/core/domain/service/CryptoService";
import type { LamportClock } from "@/core/domain/service/LamportClock";
import { PostMessageUseCase } from "@/core/usecase/PostMessageUseCase";
import { PostForm } from "@/ui/components/thread/PostForm";
import { ThreadView } from "@/ui/components/thread/ThreadView";
import { usePosts } from "@/ui/hooks/usePosts";

type Props = {
	store: IPostStore;
	cryptoService: CryptoService;
	clock: LamportClock;
	publicKey: string;
	odId: string;
	peerId: string;
	gateway: IGossipMessageGateway;
};

export function BoardPage({
	store,
	cryptoService,
	clock,
	publicKey,
	odId,
	peerId,
	gateway,
}: Props) {
	const posts = usePosts(store, DEFAULT_THREAD_ID);

	const usecase = useMemo(
		() =>
			new PostMessageUseCase(
				store,
				cryptoService,
				clock,
				{
					publicKey,
					odId,
					peerId,
					threadId: DEFAULT_THREAD_ID,
					boardId: DEFAULT_BOARD_ID,
				},
				gateway,
			),
		[store, cryptoService, clock, publicKey, odId, peerId, gateway],
	);

	const handleSubmit = useCallback(
		(name: string, body: string) => {
			void usecase.execute({ name, body });
		},
		[usecase],
	);

	return (
		<>
			<ThreadView title={DEFAULT_THREAD_TITLE} posts={posts} />
			<PostForm onSubmit={handleSubmit} />
		</>
	);
}
