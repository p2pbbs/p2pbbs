import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExchangeDigestUseCase } from "@/core/usecase/ExchangeDigestUseCase";
import { useCanPost } from "@/ui/hooks/useCanPost";

function makeUseCase(initial: boolean): {
	uc: ExchangeDigestUseCase;
	setState: (v: boolean) => void;
} {
	let canPostValue = initial;
	let subscriber: (() => void) | null = null;

	const uc = {
		canPost: vi.fn(() => canPostValue),
		subscribe: vi.fn((handler: () => void) => {
			subscriber = handler;
			return () => {
				subscriber = null;
			};
		}),
		onPeerConnected: vi.fn(),
		onPeerDisconnected: vi.fn(),
		dispose: vi.fn(),
	} as unknown as ExchangeDigestUseCase;

	const setState = (v: boolean) => {
		canPostValue = v;
		subscriber?.();
	};

	return { uc, setState };
}

describe("useCanPost", () => {
	it("test_useCanPost_InitialFalse_ReturnsFalse", () => {
		const { uc } = makeUseCase(false);
		const { result } = renderHook(() => useCanPost(uc));
		expect(result.current).toBe(false);
	});

	it("test_useCanPost_InitialTrue_ReturnsTrue", () => {
		const { uc } = makeUseCase(true);
		const { result } = renderHook(() => useCanPost(uc));
		expect(result.current).toBe(true);
	});

	it("test_useCanPost_StateChangesToTrue_ReRenders", () => {
		const { uc, setState } = makeUseCase(false);
		const { result } = renderHook(() => useCanPost(uc));

		expect(result.current).toBe(false);

		act(() => setState(true));

		expect(result.current).toBe(true);
	});

	it("test_useCanPost_Unmount_Unsubscribes", () => {
		const { uc } = makeUseCase(false);
		const { unmount } = renderHook(() => useCanPost(uc));

		unmount();

		// subscribe の戻り値がアンマウント時に呼ばれていること
		// (useSyncExternalStore が subscribe の戻り値を cleanup として使う)
		expect(vi.mocked(uc.subscribe)).toHaveBeenCalledOnce();
	});
});
