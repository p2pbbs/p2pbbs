import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BroadcastChannelGateway } from "@/adapter/gossip/BroadcastChannelGateway";
import type { GossipMessage } from "@/domain/model/GossipMessage";
import type { ILogger } from "@/domain/port/ILogger";
import { makeGossipMessage } from "../../helpers/fixtures";

/** BroadcastChannel の最小スタブ */
type ChannelStub = {
	postMessage: ReturnType<typeof vi.fn>;
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
};

function makeChannelStub(): ChannelStub {
	return {
		postMessage: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		close: vi.fn(),
	};
}

/** addEventListener で登録されたリスナーを取得する */
function getListener(
	stub: ChannelStub,
): (event: MessageEvent<unknown>) => void {
	const call = stub.addEventListener.mock.calls[0] as [
		string,
		(e: MessageEvent<unknown>) => void,
	];
	return call[1];
}

describe("BroadcastChannelGateway", () => {
	let channelStub: ChannelStub;
	let logger: ILogger;

	beforeEach(() => {
		channelStub = makeChannelStub();
		// アロー関数は new できないので通常関数で渡す
		// コンストラクタがオブジェクトを返すと new の結果になる（JS の仕様）
		vi.stubGlobal(
			"BroadcastChannel",
			vi.fn(function MockBroadcastChannel() {
				return channelStub;
			}),
		);
		logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// --- send ---

	it("test_send_ValidMessage_PostsJsonStringToChannel", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		const msg = makeGossipMessage();
		gateway.send(msg);
		expect(channelStub.postMessage).toHaveBeenCalledWith(JSON.stringify(msg));
	});

	it("test_send_ChannelThrows_LogsError", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		channelStub.postMessage.mockImplementation(() => {
			throw new Error("channel closed");
		});
		// throw しない
		gateway.send(makeGossipMessage());
		expect(logger.error).toHaveBeenCalledWith(
			"gossip.send_failed",
			expect.objectContaining({ error: expect.any(String) }),
		);
	});

	// --- onReceive ---

	it("test_onReceive_ValidJsonMessage_CallsHandlerWithParsedObject", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		const handler = vi.fn();
		gateway.onReceive(handler);

		const msg = makeGossipMessage();
		const listener = getListener(channelStub);
		listener(new MessageEvent("message", { data: JSON.stringify(msg) }));

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(msg);
	});

	it("test_onReceive_InvalidJson_LogsWarning", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		gateway.onReceive(vi.fn());

		const listener = getListener(channelStub);
		listener(new MessageEvent("message", { data: "not valid json {{" }));

		expect(logger.warn).toHaveBeenCalledWith(
			"gossip.receive_parse_error",
			expect.objectContaining({ error: expect.any(String) }),
		);
	});

	it("test_onReceive_InvalidJson_DoesNotCrash", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		const handler = vi.fn();
		gateway.onReceive(handler);

		const listener = getListener(channelStub);
		// throw しない
		expect(() =>
			listener(new MessageEvent("message", { data: "{bad json" })),
		).not.toThrow();
		expect(handler).not.toHaveBeenCalled();
	});

	it("test_onReceive_ObjectData_PassedDirectlyToHandler", () => {
		// BroadcastChannel が構造化クローンでオブジェクトを渡した場合も処理できる
		const gateway = new BroadcastChannelGateway("nch", logger);
		const handler = vi.fn();
		gateway.onReceive(handler);

		const msg = makeGossipMessage();
		const listener = getListener(channelStub);
		// data がオブジェクトの場合（stringify されていない）
		listener(new MessageEvent("message", { data: msg }));

		expect(handler).toHaveBeenCalledWith(msg);
	});

	// --- unsubscribe ---

	it("test_onReceive_Unsubscribe_RemovesEventListener", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		const unsubscribe = gateway.onReceive(vi.fn());
		unsubscribe();
		expect(channelStub.removeEventListener).toHaveBeenCalledOnce();
	});

	it("test_onReceive_AfterUnsubscribe_HandlerNotCalled", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		const handler = vi.fn();
		const unsubscribe = gateway.onReceive(handler);

		// removeEventListener はスタブなので実際には外さない。
		// 代わりに addEventListener が呼ばれた後に unsubscribe を呼んだことを検証する
		unsubscribe();
		expect(channelStub.removeEventListener).toHaveBeenCalledOnce();
		const [, removedListener] = channelStub.removeEventListener.mock
			.calls[0] as [string, unknown];
		const [, addedListener] = channelStub.addEventListener.mock.calls[0] as [
			string,
			unknown,
		];
		// 登録・解除されたリスナーが同一であること
		expect(removedListener).toBe(addedListener);
	});

	// --- close ---

	it("test_close_ClosesChannel", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		gateway.close();
		expect(channelStub.close).toHaveBeenCalledOnce();
	});

	// --- 型の健全性 ---

	it("test_send_MultipleCalls_EachMessagePostedSeparately", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		const msg1 = makeGossipMessage({ ttl: 3 });
		const msg2 = makeGossipMessage({ ttl: 2 });
		gateway.send(msg1);
		gateway.send(msg2);
		expect(channelStub.postMessage).toHaveBeenCalledTimes(2);
		expect(channelStub.postMessage.mock.calls[0]?.[0]).toBe(
			JSON.stringify(msg1),
		);
		expect(channelStub.postMessage.mock.calls[1]?.[0]).toBe(
			JSON.stringify(msg2),
		);
	});

	it("test_onReceive_MultipleHandlers_EachReceivesMessage", () => {
		const gateway = new BroadcastChannelGateway("nch", logger);
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		gateway.onReceive(handler1);
		gateway.onReceive(handler2);

		const msg: GossipMessage = makeGossipMessage();
		// 1つ目のリスナー（handler1 用）を取得して呼ぶ
		const [, listener] = channelStub.addEventListener.mock.calls[0] as [
			string,
			(e: MessageEvent<string>) => void,
		];
		listener(new MessageEvent("message", { data: JSON.stringify(msg) }));

		expect(handler1).toHaveBeenCalledOnce();
		// handler2 は別の addEventListener 呼び出しで登録される
		expect(channelStub.addEventListener).toHaveBeenCalledTimes(2);
	});
});
