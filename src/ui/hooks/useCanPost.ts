import { useSyncExternalStore } from "react";
import type { ExchangeDigestUseCase } from "@/core/usecase/ExchangeDigestUseCase";

/** usePosts と同形。canPost() を useSyncExternalStore で購読する。 */
export function useCanPost(useCase: ExchangeDigestUseCase): boolean {
	return useSyncExternalStore(
		(callback) => useCase.subscribe(callback),
		() => useCase.canPost(),
	);
}
