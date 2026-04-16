import { useCallback, useMemo } from "react";
import { PostForm } from "@/components/thread/PostForm";
import { ThreadView } from "@/components/thread/ThreadView";
import {
	DEFAULT_BOARD_ID,
	DEFAULT_THREAD_ID,
	DEFAULT_THREAD_TITLE,
} from "@/config/constants";
import type { IGossipMessageGateway } from "@/domain/port/IGossipMessageGateway";
import type { IPostStore } from "@/domain/port/IPostStore";
import type { CryptoService } from "@/domain/service/CryptoService";
import type { LamportClock } from "@/domain/service/LamportClock";
import { usePosts } from "@/hooks/usePosts";
import { PostMessageUseCase } from "@/usecase/PostMessageUseCase";

type Props = {
	store: IPostStore;
	cryptoService: CryptoService;
	clock: LamportClock;
	publicKey: string;
	odId: string;
	gateway: IGossipMessageGateway;
};

export function BoardPage({
	store,
	cryptoService,
	clock,
	publicKey,
	odId,
	gateway,
}: Props) {
	const posts = usePosts(store, DEFAULT_THREAD_ID);

	const usecase = useMemo(
		() =>
			new PostMessageUseCase(
				store,
				cryptoService,
				clock,
				publicKey,
				odId,
				DEFAULT_THREAD_ID,
				DEFAULT_BOARD_ID,
				gateway,
			),
		[store, cryptoService, clock, publicKey, odId, gateway],
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
